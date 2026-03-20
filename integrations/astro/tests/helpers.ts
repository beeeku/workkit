import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { AstroAPIContext, CloudflareRuntime } from "../src/types";

/**
 * Creates a mock Astro APIContext with Cloudflare runtime.
 */
export function createMockContext(
	options: {
		env?: Record<string, unknown>;
		cf?: Record<string, unknown>;
		ctx?: { waitUntil: (promise: Promise<unknown>) => void };
		url?: string;
		method?: string;
	} = {},
): AstroAPIContext {
	const runtime: CloudflareRuntime = {
		env: options.env ?? {},
		cf: options.cf as unknown as IncomingRequestCfProperties | undefined,
		ctx: options.ctx as unknown as ExecutionContext | undefined,
	};

	return {
		request: new Request(options.url ?? "https://example.com/", {
			method: options.method ?? "GET",
		}),
		locals: {
			runtime,
		},
	};
}

/**
 * Creates a mock context WITHOUT the Cloudflare runtime
 * (simulates running outside Cloudflare Pages).
 */
export function createMockContextWithoutRuntime(): AstroAPIContext {
	return {
		request: new Request("https://example.com/"),
		locals: {},
	};
}

/**
 * Creates a simple Standard Schema string validator.
 */
export function stringValidator(opts?: { minLength?: number }): StandardSchemaV1<string, string> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate(value): StandardSchemaV1.Result<string> {
				if (typeof value !== "string") {
					return { issues: [{ message: "Expected a string" }] };
				}
				if (opts?.minLength && value.length < opts.minLength) {
					return {
						issues: [{ message: `String must be at least ${opts.minLength} characters` }],
					};
				}
				return { value };
			},
		},
	};
}

/**
 * Creates a simple Standard Schema number validator (parses strings to numbers).
 */
export function numberValidator(): StandardSchemaV1<number, number> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate(value): StandardSchemaV1.Result<number> {
				const num = typeof value === "string" ? Number(value) : value;
				if (typeof num !== "number" || Number.isNaN(num)) {
					return { issues: [{ message: "Expected a number" }] };
				}
				return { value: num };
			},
		},
	};
}

/**
 * Creates a mock KVNamespace-like binding.
 */
export function createMockKV(): Record<string, Function> {
	return {
		get: () => {},
		put: () => {},
		delete: () => {},
		list: () => {},
		getWithMetadata: () => {},
	};
}

/**
 * Creates a mock D1Database-like binding.
 */
export function createMockD1(): Record<string, Function> {
	return {
		prepare: () => {},
		batch: () => {},
		exec: () => {},
		dump: () => {},
	};
}

/**
 * Creates a mock object validator (duck-typing check).
 */
export function objectValidator(requiredMethods: string[], label: string): StandardSchemaV1 {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate(value): StandardSchemaV1.Result {
				if (typeof value !== "object" || value === null) {
					return { issues: [{ message: `Expected a ${label} binding` }] };
				}
				const obj = value as Record<string, unknown>;
				for (const method of requiredMethods) {
					if (typeof obj[method] !== "function") {
						return { issues: [{ message: `Expected a ${label} binding` }] };
					}
				}
				return { value };
			},
		},
	};
}
