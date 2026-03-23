import type { LogLevel } from "./types";

const MAX_STRING_LENGTH = 1024;

type Redactor = string[] | ((key: string, value: unknown) => unknown);

/**
 * Serialize a log entry to a JSON string.
 *
 * Merges fields, handles circular references, truncates long strings,
 * serializes Error objects, omits null/undefined, and applies redaction.
 *
 * @example
 * ```ts
 * const json = serialize("info", "request complete", { duration: 42, path: "/api" })
 * // '{"level":"info","msg":"request complete","ts":1234567890,"duration":42,"path":"/api"}'
 * ```
 */
export function serialize(
	level: LogLevel,
	msg: string,
	fields: Record<string, unknown>,
	redact?: Redactor,
): string {
	const entry: Record<string, unknown> = { level, msg, ts: Date.now() };

	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || value === null) continue;

		let processed: unknown = value;

		// Redaction
		if (redact) {
			if (Array.isArray(redact)) {
				if (redact.includes(key)) {
					processed = "[REDACTED]";
				}
			} else {
				processed = redact(key, processed);
			}
		}

		// Error serialization
		if (processed instanceof Error) {
			processed = { message: processed.message, name: processed.name, stack: processed.stack };
		}

		// String truncation
		if (typeof processed === "string" && processed.length > MAX_STRING_LENGTH) {
			processed = `${processed.slice(0, MAX_STRING_LENGTH)}...`;
		}

		entry[key] = processed;
	}

	const seen = new WeakSet();
	return JSON.stringify(entry, (_key, value) => {
		if (typeof value === "object" && value !== null) {
			if (seen.has(value)) return "[Circular]";
			seen.add(value);
		}
		return value;
	});
}
