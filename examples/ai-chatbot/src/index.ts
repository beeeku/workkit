import { ai, streamAI } from "@workkit/ai";
import { cacheAside, swr } from "@workkit/cache";
import { ai as aiValidator, kv as kvValidator } from "@workkit/env/validators";
import { getEnv, workkit, workkitErrorHandler } from "@workkit/hono";
import { rateLimitHeaders, rateLimitResponse, slidingWindow } from "@workkit/ratelimit";
/**
 * AI Chatbot — Streaming chatbot with rate limiting and response caching
 *
 * Demonstrates building an AI-powered API with:
 *   - @workkit/ai for typed Workers AI inference
 *   - @workkit/ratelimit for per-user request throttling
 *   - @workkit/cache for caching repeated queries (stale-while-revalidate)
 *   - Streaming responses via Server-Sent Events
 */
import { Hono } from "hono";
import { z } from "zod";

// ─── Environment Schema ───────────────────────────────────────────────────────

const envSchema = {
	AI: aiValidator(),
	RATE_LIMIT_KV: kvValidator(),
};

// ─── App Setup ────────────────────────────────────────────────────────────────

type Env = { Bindings: Record<string, unknown> };
const app = new Hono<Env>();

app.use("*", workkit({ env: envSchema }));
app.onError(workkitErrorHandler());

// ─── Rate Limiting Middleware ─────────────────────────────────────────────────
//
// BEFORE (manual rate limiting):
//   const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`
//   const count = parseInt(await env.KV.get(key) ?? '0')
//   if (count >= 20) return new Response('Too many requests', { status: 429 })
//   await env.KV.put(key, String(count + 1), { expirationTtl: 120 })
//
// AFTER (workkit):
//   - Sliding window is more accurate than fixed window
//   - Headers (X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After) added automatically
//   - rateLimitResponse() returns a proper 429 with retry info

app.use("/chat/*", async (c, next) => {
	const env = getEnv(c);
	const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "anonymous";

	const limiter = slidingWindow({
		namespace: env.RATE_LIMIT_KV,
		limit: 20, // 20 requests
		window: "1m", // per minute
	});

	const result = await limiter.check(`chat:${ip}`);

	if (!result.allowed) {
		return rateLimitResponse(
			result,
			"Rate limit exceeded. Please wait before sending more messages.",
		);
	}

	// Add rate limit headers to the response
	const headers = rateLimitHeaders(result);
	await next();

	// Attach headers to the response
	for (const [key, value] of Object.entries(headers)) {
		if (value) c.res.headers.set(key, value);
	}
});

// ─── Chat: Standard (JSON Response) ──────────────────────────────────────────
//
// Returns the full response as JSON. Good for programmatic consumption.

const chatSchema = z.object({
	message: z.string().min(1).max(4000),
	model: z.string().default("@cf/meta/llama-3.1-8b-instruct"),
	systemPrompt: z.string().default("You are a helpful assistant. Be concise."),
});

app.post("/chat", async (c) => {
	const env = getEnv(c);
	const body = chatSchema.parse(await c.req.json());

	// ─── BEFORE (raw Workers AI) ────────────────────────────────────
	// const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
	//   messages: [
	//     { role: 'system', content: 'You are helpful.' },
	//     { role: 'user', content: body.message },
	//   ],
	// })
	// // result is untyped — no autocomplete, no safety

	// ─── AFTER (workkit) ────────────────────────────────────────────
	const client = ai(env.AI);
	const result = await client.run<{ response: string }>(body.model, {
		messages: [
			{ role: "system", content: body.systemPrompt },
			{ role: "user", content: body.message },
		],
		max_tokens: 1024,
	});

	return c.json({
		response: result.data.response,
		model: result.model,
	});
});

// ─── Chat: Streaming (Server-Sent Events) ────────────────────────────────────
//
// Streams tokens as they're generated. Better UX for chat interfaces.

app.post("/chat/stream", async (c) => {
	const env = getEnv(c);
	const body = chatSchema.parse(await c.req.json());

	// streamAI handles the streaming flag and returns a ReadableStream
	const stream = await streamAI(
		env.AI,
		body.model,
		{
			messages: [
				{ role: "system", content: body.systemPrompt },
				{ role: "user", content: body.message },
			],
			max_tokens: 1024,
		},
		{
			timeout: 30_000, // 30 second timeout for the entire stream
		},
	);

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
});

// ─── Cached FAQ Responses ─────────────────────────────────────────────────────
//
// For common questions (FAQ-like), cache the AI response with SWR.
// Subsequent identical queries return instantly while revalidating in the background.

const faqSchema = z.object({
	question: z.string().min(1).max(500),
});

app.post("/chat/faq", async (c) => {
	const env = getEnv(c);
	const body = faqSchema.parse(await c.req.json());

	// Normalize the question for caching (lowercase, trimmed)
	const normalizedQuestion = body.question.toLowerCase().trim();

	// Stale-while-revalidate: return cached answer immediately, refresh in background
	const result = await swr<{ response: string }>({
		key: `faq:${normalizedQuestion}`,
		ttl: 3600, // Fresh for 1 hour
		staleWhileRevalidate: 86400, // Serve stale for up to 24 hours while refreshing
		async fetch() {
			const client = ai(env.AI);
			const aiResult = await client.run<{ response: string }>("@cf/meta/llama-3.1-8b-instruct", {
				messages: [
					{
						role: "system",
						content: "Answer frequently asked questions concisely. Keep answers under 200 words.",
					},
					{ role: "user", content: body.question },
				],
				max_tokens: 512,
			});
			return { response: aiResult.data.response };
		},
	});

	return c.json({
		response: result.data.response,
		cached: result.stale ? "stale" : result.age > 0 ? "hit" : "miss",
		age: result.age,
	});
});

// ─── Models List ──────────────────────────────────────────────────────────────

app.get("/models", (c) => {
	return c.json({
		models: [
			{ id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B", type: "text-generation" },
			{ id: "@cf/meta/llama-3.1-70b-instruct", name: "Llama 3.1 70B", type: "text-generation" },
			{ id: "@cf/mistral/mistral-7b-instruct-v0.2", name: "Mistral 7B", type: "text-generation" },
		],
	});
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));

// ─── Export ───────────────────────────────────────────────────────────────────

export default app;
