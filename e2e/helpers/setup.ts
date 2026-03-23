/**
 * Shared test utilities for E2E tests.
 *
 * Re-exports commonly used factories from @workkit/testing
 * and provides additional helpers for cross-package test scenarios.
 */

export {
	createMockKV,
	createMockD1,
	createFailingD1,
	createTestEnv,
	createRequest,
	createExecutionContext,
} from "@workkit/testing";

/**
 * Create a simple Standard Schema v1 validator.
 * Useful for tests that need schema validation without pulling in Zod/Valibot.
 */
export function createStringSchema(opts?: { minLength?: number; maxLength?: number }) {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "test" as const,
			validate(value: unknown) {
				if (typeof value !== "string") {
					return { issues: [{ message: "Expected string", path: [] }] };
				}
				if (opts?.minLength !== undefined && value.length < opts.minLength) {
					return {
						issues: [{ message: `String must be at least ${opts.minLength} characters`, path: [] }],
					};
				}
				if (opts?.maxLength !== undefined && value.length > opts.maxLength) {
					return {
						issues: [{ message: `String must be at most ${opts.maxLength} characters`, path: [] }],
					};
				}
				return { value };
			},
		},
	};
}

export function createNumberSchema(opts?: { min?: number; max?: number }) {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "test" as const,
			validate(value: unknown) {
				const num = typeof value === "number" ? value : Number(value);
				if (Number.isNaN(num)) {
					return { issues: [{ message: "Expected number", path: [] }] };
				}
				if (opts?.min !== undefined && num < opts.min) {
					return { issues: [{ message: `Number must be >= ${opts.min}`, path: [] }] };
				}
				if (opts?.max !== undefined && num > opts.max) {
					return { issues: [{ message: `Number must be <= ${opts.max}`, path: [] }] };
				}
				return { value: num };
			},
		},
	};
}

export function createObjectSchema<T extends Record<string, any>>(
	shape: Record<string, { "~standard": any }>,
) {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "test" as const,
			validate(value: unknown) {
				if (typeof value !== "object" || value === null) {
					return { issues: [{ message: "Expected object", path: [] }] };
				}
				const obj = value as Record<string, unknown>;
				const issues: Array<{
					message: string;
					path: Array<string | number | { key: string | number }>;
				}> = [];
				const result: Record<string, unknown> = {};

				for (const [key, schema] of Object.entries(shape)) {
					const fieldResult = schema["~standard"].validate(obj[key]);
					if ("issues" in fieldResult && fieldResult.issues) {
						for (const issue of fieldResult.issues) {
							issues.push({
								message: issue.message,
								path: [key, ...(issue.path || [])],
							});
						}
					} else {
						result[key] = fieldResult.value;
					}
				}

				if (issues.length > 0) return { issues };
				return { value: result as T };
			},
		},
	};
}

/**
 * Delay for a given number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
