import type { AdapterRegistry } from "./adapters";
import { buildRegistry } from "./adapters";
import { type DispatchOutcome, dispatch } from "./dispatch";
import type { ChannelName, ChannelTemplate, DispatchJob, NotifyDeps } from "./types";

export interface NotifyConsumerOptions<P = unknown> extends NotifyDeps<P> {}

export type ConsumerLookup<P> = (
	notificationId: string,
) =>
	| { template: Record<ChannelName, ChannelTemplate<P>>; fallback: ReadonlyArray<ChannelName> }
	| undefined;

/**
 * Build a queue consumer function that takes a DispatchJob and runs the
 * full dispatch pipeline. Wire this into your @workkit/queue consumer or a
 * Worker `queue` handler.
 *
 * `lookup` resolves a notification id to the template + fallback chain. Use
 * a closed-over Map of `notify.define()` results.
 */
export function createNotifyConsumer<P = unknown>(
	opts: NotifyConsumerOptions<P>,
	lookup: ConsumerLookup<P>,
): (job: DispatchJob<P>) => Promise<DispatchOutcome> {
	const registry: AdapterRegistry = buildRegistry(
		opts.adapters as Record<ChannelName, import("./types").Adapter<unknown>>,
	);
	return async (job: DispatchJob<P>) => {
		const def = lookup(job.notificationId);
		if (!def) {
			throw new Error(`notify consumer: unknown notificationId "${job.notificationId}"`);
		}
		return await dispatch(opts, registry, {
			job,
			template: def.template,
			fallback: def.fallback,
		});
	};
}
