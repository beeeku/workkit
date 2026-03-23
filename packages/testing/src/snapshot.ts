interface BindingInfo {
	type: "kv" | "d1" | "r2" | "queue" | "do" | "var";
	count?: number;
	value?: unknown;
}

export interface EnvSnapshot {
	bindings: Record<string, BindingInfo>;
	summary: Record<string, number>;
}

/**
 * Inspects each binding in the env object, detects its type
 * (KV, D1, R2, Queue, DO) by checking for internal properties,
 * and returns a snapshot with counts.
 */
export function snapshotEnv(env: Record<string, unknown>): EnvSnapshot {
	const bindings: Record<string, BindingInfo> = {};
	const summary: Record<string, number> = {
		kv: 0,
		d1: 0,
		r2: 0,
		queue: 0,
		do: 0,
		var: 0,
	};

	for (const [name, binding] of Object.entries(env)) {
		if (binding === null || binding === undefined) {
			bindings[name] = { type: "var", value: binding };
			summary.var++;
			continue;
		}

		if (typeof binding !== "object") {
			bindings[name] = { type: "var", value: binding };
			summary.var++;
			continue;
		}

		const obj = binding as Record<string, unknown>;

		// R2: has _store (Map) and head method (check before KV since both have get/put)
		if (obj._store instanceof Map && typeof obj.head === "function") {
			bindings[name] = { type: "r2", count: (obj._store as Map<string, unknown>).size };
			summary.r2++;
			continue;
		}

		// DO: has _store (Map) and _alarm property
		if (obj._store instanceof Map && "_alarm" in obj) {
			bindings[name] = { type: "do", count: (obj._store as Map<string, unknown>).size };
			summary.do++;
			continue;
		}

		// KV: has _store (Map) and get/put/list/delete methods
		if (
			obj._store instanceof Map &&
			typeof obj.get === "function" &&
			typeof obj.list === "function" &&
			typeof obj.put === "function"
		) {
			bindings[name] = { type: "kv", count: (obj._store as Map<string, unknown>).size };
			summary.kv++;
			continue;
		}

		// D1: has prepare method (and no _store)
		if (typeof obj.prepare === "function" && typeof obj.batch === "function") {
			bindings[name] = { type: "d1" };
			summary.d1++;
			continue;
		}

		// Queue: has _messages array
		if (Array.isArray(obj._messages)) {
			bindings[name] = { type: "queue", count: (obj._messages as unknown[]).length };
			summary.queue++;
			continue;
		}

		// Default: treat as var
		bindings[name] = { type: "var", value: binding };
		summary.var++;
	}

	return { bindings, summary };
}
