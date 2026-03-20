import type { StandardSchemaV1 } from "@standard-schema/spec";

export interface KVValidatorOptions {
	/** Custom error message when binding is missing or invalid */
	message?: string;
}

/**
 * Creates a Standard Schema validator for KVNamespace bindings.
 *
 * @example
 * ```ts
 * import { kv } from '@workkit/env/validators'
 * const schema = { CACHE: kv() }
 * ```
 */
export function kv(options?: KVValidatorOptions): StandardSchemaV1<KVNamespace, KVNamespace> {
	return {
		"~standard": {
			version: 1,
			vendor: "workkit",
			validate(value): StandardSchemaV1.Result<KVNamespace> {
				if (!isKVNamespace(value)) {
					return {
						issues: [
							{
								message:
									options?.message ??
									"Expected a KVNamespace binding. Ensure this binding is configured in wrangler.toml under [[kv_namespaces]].",
							},
						],
					};
				}
				return { value: value as KVNamespace };
			},
		},
	};
}

function isKVNamespace(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.get === "function" &&
		typeof obj.put === "function" &&
		typeof obj.delete === "function" &&
		typeof obj.list === "function" &&
		typeof obj.getWithMetadata === "function"
	);
}
