/**
 * Queue Worker — Producer/consumer pattern with dead letter queue
 *
 * Demonstrates processing background jobs with:
 *   - @workkit/queue for typed producers and consumers
 *   - @workkit/errors for classifying retriable vs. permanent failures
 *   - Dead letter queue (DLQ) for messages that exceed max retries
 *
 * Architecture:
 *   HTTP Request → Producer → Main Queue → Consumer → (success | retry | DLQ)
 *                                                         ↓
 *                                             DLQ Queue → DLQ Processor → Alert
 */
import { parseEnv } from "@workkit/env";
import { queue as queueValidator } from "@workkit/env/validators";
import { WorkkitError, isRetryable } from "@workkit/errors";
import { queue } from "@workkit/queue";
import { RetryAction, createConsumer, createDLQProcessor } from "@workkit/queue";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailJob {
	type: "welcome" | "reset-password" | "notification";
	to: string;
	subject: string;
	templateId: string;
	data: Record<string, unknown>;
	attemptedAt?: string;
}

// ─── Environment Schema ───────────────────────────────────────────────────────

const envSchema = {
	EMAIL_QUEUE: queueValidator(),
	EMAIL_DLQ: queueValidator(),
	EMAIL_API_KEY: z.string().min(1),
};

// ─── Simulated Email Service ──────────────────────────────────────────────────

async function sendEmail(job: EmailJob, apiKey: string): Promise<void> {
	// Simulate transient failures (network, rate limits)
	if (Math.random() < 0.1) {
		const error = new Error("Email service temporarily unavailable");
		(error as any).retryable = true;
		throw error;
	}

	// Simulate permanent failures (invalid address)
	if (job.to.includes("invalid")) {
		throw new Error(`Invalid email address: ${job.to}`);
	}

	console.log(`[email] Sent "${job.subject}" to ${job.to} via template ${job.templateId}`);
}

// ─── HTTP Producer ────────────────────────────────────────────────────────────

const sendEmailSchema = z.object({
	type: z.enum(["welcome", "reset-password", "notification"]),
	to: z.string().email(),
	subject: z.string().min(1),
	templateId: z.string().min(1),
	data: z.record(z.unknown()).default({}),
});

async function handleFetch(request: Request, rawEnv: Record<string, unknown>): Promise<Response> {
	if (request.method !== "POST") {
		return Response.json({ error: "Method not allowed" }, { status: 405 });
	}

	const env = await parseEnv(rawEnv, envSchema);
	const url = new URL(request.url);

	if (url.pathname === "/send") {
		const body = sendEmailSchema.parse(await request.json());

		// ─── BEFORE (raw Cloudflare API) ────────────────────────────────
		// await env.EMAIL_QUEUE.send(body)
		// // No type safety — body could be anything
		// // No batch support
		// // No way to know if the queue binding exists until runtime

		// ─── AFTER (workkit) ────────────────────────────────────────────
		const emailQueue = queue<EmailJob>(env.EMAIL_QUEUE);
		await emailQueue.send({
			...body,
			attemptedAt: new Date().toISOString(),
		});

		return Response.json({ message: "Email queued", to: body.to });
	}

	if (url.pathname === "/send-batch") {
		const body = z.array(sendEmailSchema).parse(await request.json());

		const emailQueue = queue<EmailJob>(env.EMAIL_QUEUE);
		await emailQueue.sendBatch(
			body.map((job) => ({
				body: { ...job, attemptedAt: new Date().toISOString() },
			})),
		);

		return Response.json({ message: `${body.length} emails queued` });
	}

	return Response.json({ error: "Not found" }, { status: 404 });
}

// ─── Queue Consumer ───────────────────────────────────────────────────────────
//
// The consumer processes messages one at a time with retry logic.
// After maxRetries failures, the message is forwarded to the DLQ.
//
// BEFORE (raw Cloudflare API):
//   export default {
//     async queue(batch, env) {
//       for (const msg of batch.messages) {
//         try {
//           await sendEmail(msg.body)
//           msg.ack()
//         } catch (e) {
//           if (msg.attempts < 3) msg.retry()
//           else {
//             await env.DLQ.send(msg.body)  // manual DLQ forwarding
//             msg.ack()
//           }
//         }
//       }
//     }
//   }
//
// AFTER (workkit):
//   - Declarative maxRetries + DLQ binding
//   - Return RetryAction for fine-grained control
//   - Per-message error callback for logging
//   - Concurrency control built in

const emailConsumer = createConsumer<EmailJob>({
	maxRetries: 3,

	async process(message) {
		const job = message.body;
		console.log(
			`[consumer] Processing ${job.type} email to ${job.to} (attempt ${message.attempts})`,
		);

		try {
			await sendEmail(job, ""); // API key would come from env in real usage
			// Returning void = success, message will be acked
		} catch (error) {
			// Classify the error: is it worth retrying?
			if (error instanceof Error && (error as any).retryable) {
				// Transient error — retry with delay
				return RetryAction.RETRY;
			}

			// Permanent error — send to dead letter queue immediately
			return RetryAction.DEAD_LETTER;
		}
	},

	onError(error, message) {
		console.error(
			`[consumer] Failed to process message ${message.id}:`,
			error instanceof Error ? error.message : error,
			`(attempt ${message.attempts})`,
		);
	},

	concurrency: 5, // Process up to 5 messages in parallel
});

// ─── Dead Letter Queue Processor ──────────────────────────────────────────────
//
// Messages that fail all retries end up here. This processor logs them
// and could alert an on-call team, write to a database, or queue a manual review.

const dlqProcessor = createDLQProcessor<EmailJob>({
	async process(message, metadata) {
		console.error(
			`[DLQ] Message ${metadata.messageId} failed after ${metadata.attempts} attempts`,
			`Queue: ${metadata.queue}`,
			`Job: ${JSON.stringify(message.body)}`,
		);

		// In production, you would:
		// - Send an alert to Slack/PagerDuty
		// - Store in a D1 table for manual review
		// - Emit a metric to your observability platform
	},

	onError(error, message) {
		console.error("[DLQ] Failed to process DLQ message:", error);
	},
});

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
	fetch: handleFetch,

	async queue(batch: MessageBatch<EmailJob>, env: Record<string, unknown>): Promise<void> {
		const validatedEnv = await parseEnv(env, envSchema);

		// Route to the correct consumer based on which queue delivered the batch
		if (batch.queue === "email-dlq") {
			await dlqProcessor(batch as any, env);
		} else {
			// Pass the DLQ binding to the consumer for automatic forwarding
			const consumer = createConsumer<EmailJob>({
				maxRetries: 3,
				deadLetterQueue: validatedEnv.EMAIL_DLQ as any,
				async process(message) {
					await sendEmail(message.body, validatedEnv.EMAIL_API_KEY);
				},
				onError(error, message) {
					console.error("[consumer] Error:", error);
				},
				concurrency: 5,
			});
			await consumer(batch as any, env);
		}
	},
};
