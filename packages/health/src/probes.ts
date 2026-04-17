import type { ProbeConfig } from "./types";

interface ProbeOptions {
	critical?: boolean;
	timeout?: number;
}

/**
 * Probes a KV namespace by reading a sentinel key.
 * A null result (key not found) is considered healthy — only thrown errors indicate failure.
 */
export function kvProbe(kv: KVNamespace, options?: ProbeOptions): ProbeConfig {
	return {
		name: "kv",
		critical: options?.critical ?? true,
		timeout: options?.timeout,
		check: async () => {
			await kv.get("__health__");
		},
	};
}

/**
 * Probes a D1 database by executing `SELECT 1 as ok`.
 */
export function d1Probe(d1: D1Database, options?: ProbeOptions): ProbeConfig {
	return {
		name: "d1",
		critical: options?.critical ?? true,
		timeout: options?.timeout,
		check: async () => {
			await d1.prepare("SELECT 1 as ok").first();
		},
	};
}

/**
 * Probes an R2 bucket by issuing a HEAD request for a sentinel key.
 * A null result (object not found) is considered healthy.
 */
export function r2Probe(r2: R2Bucket, options?: ProbeOptions): ProbeConfig {
	return {
		name: "r2",
		critical: options?.critical ?? true,
		timeout: options?.timeout,
		check: async () => {
			await r2.head("__health__");
		},
	};
}

/**
 * Probes an AI binding by verifying the `run` method exists.
 * Does not invoke the binding to avoid side effects.
 */
export function aiProbe(ai: Ai, options?: ProbeOptions): ProbeConfig {
	return {
		name: "ai",
		critical: options?.critical ?? true,
		timeout: options?.timeout,
		check: async () => {
			if (typeof ai.run !== "function") {
				throw new Error("AI binding is invalid: run is not a function");
			}
		},
	};
}

/**
 * Probes a Durable Object namespace by generating an id from a sentinel name.
 * This verifies the namespace binding is valid without instantiating a stub.
 */
export function doProbe(ns: DurableObjectNamespace, options?: ProbeOptions): ProbeConfig {
	return {
		name: "do",
		critical: options?.critical ?? true,
		timeout: options?.timeout,
		check: async () => {
			ns.idFromName("__health__");
		},
	};
}

/**
 * Probes a Queue binding by verifying the `send` method exists.
 * Does not send messages to avoid side effects.
 */
export function queueProbe(queue: Queue, options?: ProbeOptions): ProbeConfig {
	return {
		name: "queue",
		critical: options?.critical ?? true,
		timeout: options?.timeout,
		check: async () => {
			if (typeof queue.send !== "function") {
				throw new Error("Queue binding is invalid: send is not a function");
			}
		},
	};
}
