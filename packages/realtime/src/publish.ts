import { singleton } from "@workkit/do";
import type { PublishResult } from "./types";

export async function publish(
	namespace: DurableObjectNamespace,
	channel: string,
	event: string,
	data: unknown,
): Promise<PublishResult> {
	// Surface the footgun at the call site — JSON.stringify(undefined) produces
	// no output and the broker would 400 with an opaque "data required" error.
	if (data === undefined) {
		throw new Error(`publish: data cannot be undefined (channel "${channel}", event "${event}")`);
	}
	const stub = singleton(namespace, channel);
	const response = await stub.fetch("https://do-rpc.internal/publish", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ event, data }),
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`publish to "${channel}" failed (${response.status}): ${body}`);
	}
	return (await response.json()) as PublishResult;
}
