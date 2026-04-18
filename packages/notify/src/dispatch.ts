import type { AdapterRegistry } from "./adapters";
import { resolveConfig } from "./config";
import { NoRecipientError } from "./errors";
import { isOptedOut } from "./opt-out";
import { readPreferences } from "./preferences";
import { isWithinQuietHours } from "./quiet-hours";
import { findByIdempotencyKey, insertDelivery, updateDeliveryStatus } from "./records";
import type {
	AdapterSendArgs,
	ChannelName,
	ChannelTemplate,
	DispatchJob,
	NotifyConfig,
	NotifyDeps,
} from "./types";

export interface DispatchInput<P> {
	job: DispatchJob<P>;
	template: Record<ChannelName, ChannelTemplate<P>>;
	fallback: ReadonlyArray<ChannelName>;
}

export interface DispatchOutcome {
	jobId: string;
	finalStatus: "delivered" | "sent" | "failed" | "skipped" | "duplicate";
	channelAttempted: ChannelName | null;
	deliveryId: string | null;
}

const PLACEHOLDER_CHANNEL = "_pending";

/**
 * The dispatcher pipeline. Runs INSIDE a queue consumer for race-safety
 * (opt-out, quiet-hours, idempotency are all re-read here).
 *
 * Inserts ONE delivery row per dispatch (keyed by idempotency_key). Each
 * channel attempt updates the row's `channel` + `status` + `error`. This
 * keeps fallback chains race-safe with the UNIQUE(idempotency_key) index.
 */
export async function dispatch<P>(
	deps: NotifyDeps<P>,
	registry: AdapterRegistry,
	input: DispatchInput<P>,
): Promise<DispatchOutcome> {
	const cfg: NotifyConfig = resolveConfig(deps.config);
	const now = deps.now ?? Date.now;

	// 1. Idempotency check.
	const existing = await findByIdempotencyKey(deps.db, input.job.idempotencyKey);
	if (existing) {
		return {
			jobId: input.job.id,
			finalStatus: "duplicate",
			channelAttempted: existing.channel === PLACEHOLDER_CHANNEL ? null : existing.channel,
			deliveryId: existing.id,
		};
	}

	// 2. Resolve recipient.
	const recipient = await deps.resolver(input.job.userId);
	if (!recipient) throw new NoRecipientError(input.job.userId);

	// 3. Reserve a single delivery row up front (channel='_pending') so siblings
	//    racing on the same idempotency key short-circuit cleanly.
	const deliveryId = crypto.randomUUID();
	const inserted = await insertDelivery(deps.db, {
		id: deliveryId,
		userId: input.job.userId,
		notificationId: input.job.notificationId,
		channel: PLACEHOLDER_CHANNEL,
		status: "queued",
		idempotencyKey: input.job.idempotencyKey,
		payload: input.job.mode === "test" ? null : safeStringify(input.job.payload),
		attemptedAt: now(),
	});
	if (!inserted) {
		// Lost the race; another worker has the row.
		const winner = await findByIdempotencyKey(deps.db, input.job.idempotencyKey);
		return {
			jobId: input.job.id,
			finalStatus: "duplicate",
			channelAttempted: winner?.channel === PLACEHOLDER_CHANNEL ? null : (winner?.channel ?? null),
			deliveryId: winner?.id ?? null,
		};
	}

	// 4. Determine ordered channel list.
	const prefs = await readPreferences(deps.db, input.job.userId, input.job.notificationId);
	const candidateChannels: ChannelName[] = (
		prefs?.channels && prefs.channels.length > 0
			? prefs.channels
			: input.fallback.length > 0
				? input.fallback
				: Object.keys(input.template)
	) as ChannelName[];

	// 5. Quiet hours bypass (allowlist + priority:'high').
	const quietHours = prefs?.quietHours;
	const inQuiet = quietHours ? isWithinQuietHours(quietHours, new Date(now())) : false;
	const allowedToBypass =
		input.job.priority === "high" && cfg.priorityAllowlist.includes(input.job.notificationId);

	// 6. Walk channels.
	let lastError: string | undefined;
	let everEligible = false;
	for (const channel of candidateChannels) {
		const template = input.template[channel];
		if (!template) continue;

		if (inQuiet && !allowedToBypass) continue;

		const optedOut = await isOptedOut(deps.db, input.job.userId, channel, input.job.notificationId);
		if (optedOut) continue;

		const address = recipient.channels.find((c) => c.channel === channel)?.address;
		if (!address) continue;

		const adapter = registry.get(channel);
		if (!adapter) {
			lastError = `no adapter registered for channel "${channel}"`;
			continue;
		}

		everEligible = true;

		// Test mode: short-circuit at the very last step before the adapter call.
		if (input.job.mode === "test") {
			deps.logger?.info("notify: test sink", { channel, notificationId: input.job.notificationId });
			await updateDeliveryStatus(deps.db, deliveryId, "sent", { providerId: "test-sink" });
			await setChannel(deps.db, deliveryId, channel);
			return { jobId: input.job.id, finalStatus: "sent", channelAttempted: channel, deliveryId };
		}

		const args: AdapterSendArgs<P> = {
			userId: input.job.userId,
			notificationId: input.job.notificationId,
			channel,
			address,
			template,
			payload: input.job.payload,
			deliveryId,
			mode: input.job.mode,
		};
		try {
			const result = await (
				adapter as {
					send: (a: AdapterSendArgs<P>) => Promise<{
						providerId?: string;
						status: "sent" | "delivered" | "read" | "failed" | "bounced";
						error?: string;
					}>;
				}
			).send(args);
			if (result.status === "sent" || result.status === "delivered" || result.status === "read") {
				await setChannel(deps.db, deliveryId, channel);
				await updateDeliveryStatus(
					deps.db,
					deliveryId,
					result.status === "read" ? "delivered" : result.status,
					{
						providerId: result.providerId,
						error: undefined,
						deliveredAt: result.status === "delivered" ? now() : undefined,
					},
				);
				return {
					jobId: input.job.id,
					finalStatus: result.status === "read" ? "delivered" : result.status,
					channelAttempted: channel,
					deliveryId,
				};
			}
			lastError = result.error ?? `adapter returned status:${result.status}`;
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}
	}

	// 7. Final disposition. If no channel was ever eligible (all opted-out / quiet-hours-skipped) AND we had candidates, mark skipped; else failed.
	const finalStatus: "skipped" | "failed" =
		!everEligible && candidateChannels.length > 0 ? "skipped" : "failed";
	await updateDeliveryStatus(deps.db, deliveryId, finalStatus, {
		error: finalStatus === "failed" ? (lastError ?? "no eligible channel") : undefined,
	});
	return {
		jobId: input.job.id,
		finalStatus,
		channelAttempted: null,
		deliveryId,
	};
}

async function setChannel(
	db: import("./types").NotifyD1,
	id: string,
	channel: ChannelName,
): Promise<void> {
	await db
		.prepare("UPDATE notification_deliveries SET channel = ? WHERE id = ?")
		.bind(channel, id)
		.run();
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable payload]";
	}
}
