import type { StandardSchemaV1 } from "@standard-schema/spec";
import { NotifyConfigError, PayloadValidationError } from "./errors";
import { buildIdempotencyKey } from "./idempotency";
import type {
	ChannelName,
	ChannelTemplate,
	DefineNotificationOptions,
	DispatchJob,
	NotifyD1,
	Priority,
	SendOptions,
	SendResult,
} from "./types";

export interface Notification<P> {
	readonly id: string;
	readonly priority: Priority;
	readonly channels: Record<ChannelName, ChannelTemplate<P>>;
	readonly fallback: ReadonlyArray<ChannelName>;
	readonly schema: StandardSchemaV1<P>;
	send(payload: P, target: { userId: string }, options?: SendOptions): Promise<SendResult>;
}

export interface DefineDeps {
	enqueue: (job: DispatchJob<unknown>) => Promise<void>;
	db?: NotifyD1; // optional — only used to short-circuit duplicate before enqueue
	now?: () => number;
}

/**
 * Define a notification. Returns an object with a typed `send()`. Validation
 * of inputs happens here:
 *  - duplicate channel in `fallback` → ConfigError
 *  - unknown channel referenced from `fallback` → ConfigError
 *  - empty `channels` map → ConfigError
 */
export function define<P>(
	options: DefineNotificationOptions<P>,
	deps: DefineDeps,
): Notification<P> {
	if (Object.keys(options.channels).length === 0) {
		throw new NotifyConfigError(`notify.define("${options.id}"): channels map is empty`);
	}
	const fallback = options.fallback ?? [];
	const seen = new Set<ChannelName>();
	for (const ch of fallback) {
		if (seen.has(ch)) {
			throw new NotifyConfigError(
				`notify.define("${options.id}"): duplicate channel "${ch}" in fallback chain`,
			);
		}
		seen.add(ch);
		if (!options.channels[ch]) {
			throw new NotifyConfigError(
				`notify.define("${options.id}"): fallback channel "${ch}" missing from channels map`,
			);
		}
	}

	const priority: Priority = options.priority ?? "normal";

	return {
		id: options.id,
		priority,
		channels: options.channels,
		fallback,
		schema: options.schema,
		async send(payload, target, sendOpts): Promise<SendResult> {
			const validated = await options.schema["~standard"].validate(payload);
			if (validated.issues) {
				throw new PayloadValidationError(
					options.id,
					validated.issues.map((i) => ({
						path: (i.path ?? []).map((p) =>
							typeof p === "object" && p !== null && "key" in p
								? (p.key as PropertyKey)
								: (p as PropertyKey),
						),
						message: i.message,
					})),
				);
			}

			const idempotencyKey = await buildIdempotencyKey({
				userId: target.userId,
				notificationId: options.id,
				payload: validated.value,
				override: sendOpts?.idempotencyKey,
			});

			const job: DispatchJob<P> = {
				id: cryptoRandomId(),
				userId: target.userId,
				notificationId: options.id,
				payload: validated.value as P,
				idempotencyKey,
				priority,
				mode: sendOpts?.mode ?? "live",
				createdAt: deps.now?.() ?? Date.now(),
			};
			await deps.enqueue(job as DispatchJob<unknown>);
			return { id: job.id, status: "queued", idempotencyKey };
		},
	};
}

function cryptoRandomId(): string {
	// crypto.randomUUID is available in Workers + modern Node.
	return crypto.randomUUID();
}
