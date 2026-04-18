import type { CfGatewayConfig, GatewayToolCall, RunOptions, TokenUsage } from "../types";

/**
 * Resolve the effective base URL for an HTTP provider, preferring (in order):
 *   1. explicit `baseUrl` on the provider config
 *   2. CF AI Gateway URL derived from `cfGateway`
 *   3. the provider's public API default
 */
export function resolveBaseUrl(
	provider: "openai" | "anthropic",
	explicit: string | undefined,
	cf: CfGatewayConfig | undefined,
	providerDefault: string,
): string {
	if (explicit) return explicit;
	if (cf) {
		const prefix = `https://gateway.ai.cloudflare.com/v1/${cf.accountId}/${cf.gatewayId}`;
		return provider === "anthropic" ? `${prefix}/anthropic/v1` : `${prefix}/openai`;
	}
	return providerDefault;
}

/** Build the cf-aig-* header set for a request, omitting undefined fields. */
export function cfGatewayHeaders(cf: CfGatewayConfig | undefined): Record<string, string> {
	if (!cf) return {};
	const headers: Record<string, string> = {};
	if (cf.authToken) headers["cf-aig-authorization"] = `Bearer ${cf.authToken}`;
	if (cf.cacheTtl !== undefined) headers["cf-aig-cache-ttl"] = String(cf.cacheTtl);
	if (cf.skipCache) headers["cf-aig-skip-cache"] = "true";
	return headers;
}

/**
 * Resolve the effective AbortSignal for a request, combining an optional
 * `options.signal` with an `options.timeout` deadline. Returns a cleanup fn
 * the caller must run in a `finally` block to clear the timer and drop any
 * listener we added to the external signal.
 *
 * Semantics:
 *  - signal only  → pass-through, no timer, no extra listener.
 *  - timeout only → derived signal aborts when the timer fires.
 *  - both         → derived signal aborts on whichever fires first.
 *  - neither      → `{ signal: undefined }`.
 */
export function withTimeoutSignal(options: RunOptions | undefined): {
	signal: AbortSignal | undefined;
	cleanup: () => void;
} {
	const sourceSignal = options?.signal;
	const timeout = options?.timeout;

	if (!timeout) {
		return { signal: sourceSignal, cleanup: noopCleanup };
	}

	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let onSourceAbort: (() => void) | undefined;

	if (sourceSignal?.aborted) {
		controller.abort(sourceSignal.reason);
	} else {
		timeoutId = setTimeout(() => controller.abort(), timeout);
		if (sourceSignal) {
			onSourceAbort = () => controller.abort(sourceSignal.reason);
			sourceSignal.addEventListener("abort", onSourceAbort, { once: true });
		}
	}

	return {
		signal: controller.signal,
		cleanup: () => {
			if (timeoutId) clearTimeout(timeoutId);
			if (sourceSignal && onSourceAbort) {
				sourceSignal.removeEventListener("abort", onSourceAbort);
			}
		},
	};
}

function noopCleanup(): void {
	return;
}

/**
 * Parse raw tool calls from Workers AI / OpenAI format.
 * Both use: `{ id, type: "function", function: { name, arguments } }`.
 */
export function parseRawToolCalls(rawCalls: Array<Record<string, unknown>>): GatewayToolCall[] {
	const calls: GatewayToolCall[] = [];
	for (const raw of rawCalls) {
		const fn = raw.function as Record<string, unknown> | undefined;
		if (!fn || typeof fn.name !== "string") continue;

		let args: Record<string, unknown> = {};
		if (typeof fn.arguments === "string") {
			try {
				args = JSON.parse(fn.arguments) as Record<string, unknown>;
			} catch {
				args = {};
			}
		} else if (fn.arguments != null && typeof fn.arguments === "object") {
			args = fn.arguments as Record<string, unknown>;
		}

		calls.push({
			id: typeof raw.id === "string" ? raw.id : `call_${calls.length}`,
			name: fn.name,
			arguments: args,
		});
	}
	return calls;
}

/** Generic usage extractor for OpenAI-compatible `{prompt,completion}_tokens` */
export function extractOpenAiStyleUsage(raw: unknown): TokenUsage | undefined {
	if (raw == null || typeof raw !== "object") return undefined;
	const obj = raw as Record<string, unknown>;
	const usage = obj.usage as Record<string, unknown> | undefined;
	if (!usage) return undefined;
	const input = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
	const output = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
	if (input === 0 && output === 0) return undefined;
	return { inputTokens: input, outputTokens: output };
}
