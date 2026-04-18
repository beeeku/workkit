import { ValidationError } from "@workkit/errors";

/**
 * Recursively sort object keys so two payloads with the same data hash to
 * the same string regardless of key insertion order. Rejects NaN/Infinity
 * and circular references — both indicate caller bugs. Shared (DAG-style)
 * references that are not cyclic are allowed — we track only the active
 * recursion path, not every value seen.
 */
export function canonicalJson(value: unknown, stack: WeakSet<object> = new WeakSet()): string {
	if (value === null) return "null";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new ValidationError("non-finite number rejected from canonical JSON", [
				{ path: [], message: `value is ${value}` },
			]);
		}
		return JSON.stringify(value);
	}
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "bigint") return JSON.stringify(value.toString());
	if (typeof value === "undefined") return "null";
	if (typeof value !== "object") return JSON.stringify(String(value));

	if (stack.has(value as object)) {
		throw new ValidationError("circular reference rejected from canonical JSON", [
			{ path: [], message: "circular reference" },
		]);
	}
	stack.add(value as object);
	try {
		if (Array.isArray(value)) {
			return `[${value.map((v) => canonicalJson(v, stack)).join(",")}]`;
		}
		const keys = Object.keys(value as Record<string, unknown>).sort();
		const parts = keys.map(
			(k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k], stack)}`,
		);
		return `{${parts.join(",")}}`;
	} finally {
		stack.delete(value as object);
	}
}

/** SHA-256 → hex via Web Crypto (available in Workers). */
export async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(hash);
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i]!.toString(16).padStart(2, "0");
	}
	return out;
}

/**
 * Build the dispatch idempotency key from `(userId, notificationId, payload)`.
 * Caller can short-circuit by supplying `override` for explicit retry-dedup
 * scenarios.
 */
export async function buildIdempotencyKey(args: {
	userId: string;
	notificationId: string;
	payload: unknown;
	override?: string;
}): Promise<string> {
	if (args.override) return args.override;
	const canon = canonicalJson({
		userId: args.userId,
		notificationId: args.notificationId,
		payload: args.payload,
	});
	return await sha256Hex(canon);
}
