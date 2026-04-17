import { describe, expect, it, vi } from "vitest";
import { StructuredOutputError } from "../src/errors";
import { structuredAI } from "../src/structured";
import type { AiBinding } from "../src/types";

// ─── Helpers ─────────────────────────────────────────────────

/** Create a mock AI binding that returns configured responses in sequence */
function createMockBinding(...responses: unknown[]): AiBinding & {
	calls: Array<{ model: string; inputs: Record<string, unknown> }>;
} {
	const calls: Array<{ model: string; inputs: Record<string, unknown> }> = [];
	let callIndex = 0;
	return {
		calls,
		async run(model: string, inputs: Record<string, unknown>) {
			calls.push({ model, inputs });
			const response = responses[callIndex] ?? responses[responses.length - 1];
			callIndex++;
			return response;
		},
	};
}

/** Create a simple Standard Schema v1 compatible schema for testing */
function createSchema<T>(
	validateFn: (
		value: unknown,
	) =>
		| { value: T; issues?: undefined }
		| { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey> }> },
	jsonSchemaOverride?: Record<string, unknown>,
) {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "test",
			validate: validateFn,
		},
		...(jsonSchemaOverride ? { toJSONSchema: () => jsonSchemaOverride } : {}),
	};
}

/** Schema that accepts any object with a "name" string field */
function nameSchema() {
	return createSchema<{ name: string }>(
		(value) => {
			if (typeof value !== "object" || value === null) {
				return { issues: [{ message: "Expected an object" }] };
			}
			const obj = value as Record<string, unknown>;
			if (typeof obj.name !== "string") {
				return { issues: [{ message: "Expected name to be a string", path: ["name"] }] };
			}
			return { value: value as { name: string } };
		},
		{ type: "object", properties: { name: { type: "string" } }, required: ["name"] },
	);
}

// ─── Tests ───────────────────────────────────────────────────

describe("structuredAI()", () => {
	it("returns parsed data when model returns valid JSON matching schema", async () => {
		const binding = createMockBinding({ response: '{"name":"Alice"}' });
		const schema = nameSchema();

		const result = await structuredAI(
			binding,
			"@cf/meta/llama-3.1-8b-instruct",
			{ messages: [{ role: "user", content: "Give me a name" }] },
			{ schema },
		);

		expect(result.data).toEqual({ name: "Alice" });
		expect(result.raw).toBe('{"name":"Alice"}');
		expect(result.model).toBe("@cf/meta/llama-3.1-8b-instruct");
	});

	it("adds response_format and system message to the input", async () => {
		const binding = createMockBinding({ response: '{"name":"Bob"}' });
		const schema = nameSchema();

		await structuredAI(
			binding,
			"model",
			{ messages: [{ role: "user", content: "Give me a name" }] },
			{ schema },
		);

		expect(binding.calls).toHaveLength(1);
		const sentInput = binding.calls[0].inputs;
		expect(sentInput.response_format).toEqual({ type: "json_object" });

		// Should have system message prepended + user message
		const messages = sentInput.messages as Array<{ role: string; content: string }>;
		expect(messages[0].role).toBe("system");
		expect(messages[0].content).toContain("JSON");
		expect(messages[1].role).toBe("user");
		expect(messages[1].content).toBe("Give me a name");
	});

	it("retries on invalid JSON response with error context", async () => {
		const binding = createMockBinding(
			{ response: "not json at all" },
			{ response: '{"name":"Fixed"}' },
		);
		const schema = nameSchema();

		const result = await structuredAI(
			binding,
			"model",
			{ messages: [{ role: "user", content: "Give me a name" }] },
			{ schema, maxRetries: 1 },
		);

		expect(result.data).toEqual({ name: "Fixed" });
		expect(binding.calls).toHaveLength(2);

		// Second call should have error context appended
		const secondMessages = binding.calls[1].inputs.messages as Array<{
			role: string;
			content: string;
		}>;
		// Should contain the assistant's failed response and a retry instruction
		const assistantMsg = secondMessages.find(
			(m) => m.role === "assistant" && m.content === "not json at all",
		);
		expect(assistantMsg).toBeDefined();
		const retryMsg = secondMessages.find(
			(m) => m.role === "user" && m.content.includes("not valid JSON"),
		);
		expect(retryMsg).toBeDefined();
	});

	it("retries on schema validation failure with error context", async () => {
		const binding = createMockBinding(
			{ response: '{"age":25}' }, // missing "name"
			{ response: '{"name":"Fixed"}' },
		);
		const schema = nameSchema();

		const result = await structuredAI(
			binding,
			"model",
			{ messages: [{ role: "user", content: "Give me a name" }] },
			{ schema, maxRetries: 1 },
		);

		expect(result.data).toEqual({ name: "Fixed" });
		expect(binding.calls).toHaveLength(2);

		// Second call should include validation error context
		const secondMessages = binding.calls[1].inputs.messages as Array<{
			role: string;
			content: string;
		}>;
		const retryMsg = secondMessages.find(
			(m) => m.role === "user" && m.content.includes("validation errors"),
		);
		expect(retryMsg).toBeDefined();
	});

	it("throws StructuredOutputError when max retries exceeded on invalid JSON", async () => {
		const binding = createMockBinding({ response: "not json" }, { response: "still not json" });
		const schema = nameSchema();

		await expect(
			structuredAI(
				binding,
				"model",
				{ messages: [{ role: "user", content: "Give me a name" }] },
				{ schema, maxRetries: 1 },
			),
		).rejects.toThrow(StructuredOutputError);
	});

	it("throws StructuredOutputError when max retries exceeded on validation failure", async () => {
		const binding = createMockBinding({ response: '{"age":1}' }, { response: '{"age":2}' });
		const schema = nameSchema();

		try {
			await structuredAI(
				binding,
				"model",
				{ messages: [{ role: "user", content: "test" }] },
				{ schema, maxRetries: 1 },
			);
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(StructuredOutputError);
			const sErr = err as StructuredOutputError;
			expect(sErr.raw).toBe('{"age":2}');
			expect(sErr.issues.length).toBeGreaterThan(0);
		}
	});

	it("throws StructuredOutputError on non-JSON response with 0 retries", async () => {
		const binding = createMockBinding({ response: "Hello world!" });
		const schema = nameSchema();

		await expect(
			structuredAI(
				binding,
				"model",
				{ messages: [{ role: "user", content: "test" }] },
				{ schema, maxRetries: 0 },
			),
		).rejects.toThrow(StructuredOutputError);
	});

	it("validates nested object schemas", async () => {
		const nestedSchema = createSchema<{ user: { name: string; age: number } }>(
			(value) => {
				if (typeof value !== "object" || value === null) {
					return { issues: [{ message: "Expected an object" }] };
				}
				const obj = value as Record<string, unknown>;
				if (typeof obj.user !== "object" || obj.user === null) {
					return { issues: [{ message: "Expected user to be an object", path: ["user"] }] };
				}
				const user = obj.user as Record<string, unknown>;
				if (typeof user.name !== "string") {
					return {
						issues: [{ message: "Expected name to be a string", path: ["user", "name"] }],
					};
				}
				if (typeof user.age !== "number") {
					return {
						issues: [{ message: "Expected age to be a number", path: ["user", "age"] }],
					};
				}
				return { value: value as { user: { name: string; age: number } } };
			},
			{
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: { name: { type: "string" }, age: { type: "number" } },
					},
				},
			},
		);

		const binding = createMockBinding({
			response: '{"user":{"name":"Alice","age":30}}',
		});

		const result = await structuredAI(
			binding,
			"model",
			{ messages: [{ role: "user", content: "Give me user info" }] },
			{ schema: nestedSchema },
		);

		expect(result.data).toEqual({ user: { name: "Alice", age: 30 } });
	});

	it("validates array schemas", async () => {
		const arraySchema = createSchema<{ items: string[] }>((value) => {
			if (typeof value !== "object" || value === null) {
				return { issues: [{ message: "Expected an object" }] };
			}
			const obj = value as Record<string, unknown>;
			if (!Array.isArray(obj.items)) {
				return { issues: [{ message: "Expected items to be an array", path: ["items"] }] };
			}
			for (let i = 0; i < obj.items.length; i++) {
				if (typeof obj.items[i] !== "string") {
					return {
						issues: [
							{
								message: "Expected string",
								path: ["items", i as unknown as PropertyKey],
							},
						],
					};
				}
			}
			return { value: value as { items: string[] } };
		});

		const binding = createMockBinding({
			response: '{"items":["a","b","c"]}',
		});

		const result = await structuredAI(
			binding,
			"model",
			{ messages: [{ role: "user", content: "List items" }] },
			{ schema: arraySchema },
		);

		expect(result.data).toEqual({ items: ["a", "b", "c"] });
	});

	it("validates enum/union schemas", async () => {
		const enumSchema = createSchema<{ status: "active" | "inactive" }>((value) => {
			if (typeof value !== "object" || value === null) {
				return { issues: [{ message: "Expected an object" }] };
			}
			const obj = value as Record<string, unknown>;
			if (obj.status !== "active" && obj.status !== "inactive") {
				return {
					issues: [
						{
							message: 'Expected "active" or "inactive"',
							path: ["status"],
						},
					],
				};
			}
			return { value: value as { status: "active" | "inactive" } };
		});

		const binding = createMockBinding({ response: '{"status":"active"}' });

		const result = await structuredAI(
			binding,
			"model",
			{ messages: [{ role: "user", content: "Get status" }] },
			{ schema: enumSchema },
		);

		expect(result.data).toEqual({ status: "active" });
	});

	it("validates enum/union schema rejects invalid values", async () => {
		const enumSchema = createSchema<{ status: "active" | "inactive" }>((value) => {
			if (typeof value !== "object" || value === null) {
				return { issues: [{ message: "Expected an object" }] };
			}
			const obj = value as Record<string, unknown>;
			if (obj.status !== "active" && obj.status !== "inactive") {
				return {
					issues: [
						{
							message: 'Expected "active" or "inactive"',
							path: ["status"],
						},
					],
				};
			}
			return { value: value as { status: "active" | "inactive" } };
		});

		const binding = createMockBinding({ response: '{"status":"unknown"}' });

		await expect(
			structuredAI(
				binding,
				"model",
				{ messages: [{ role: "user", content: "Get status" }] },
				{ schema: enumSchema, maxRetries: 0 },
			),
		).rejects.toThrow(StructuredOutputError);
	});

	it("throws BindingNotFoundError when binding is null", async () => {
		const schema = nameSchema();

		await expect(
			structuredAI(
				null as unknown as AiBinding,
				"model",
				{ messages: [{ role: "user", content: "test" }] },
				{ schema },
			),
		).rejects.toThrow("AI");
	});

	it("defaults to 1 retry when maxRetries is not specified", async () => {
		const binding = createMockBinding({ response: "not json" }, { response: '{"name":"OK"}' });
		const schema = nameSchema();

		// Default maxRetries = 1, so this should succeed on the retry
		const result = await structuredAI(
			binding,
			"model",
			{ messages: [{ role: "user", content: "test" }] },
			{ schema },
		);

		expect(result.data).toEqual({ name: "OK" });
		expect(binding.calls).toHaveLength(2);
	});

	it("handles model returning a plain string response", async () => {
		const binding = createMockBinding('{"name":"Direct"}');
		const schema = nameSchema();

		const result = await structuredAI(
			binding,
			"model",
			{ messages: [{ role: "user", content: "test" }] },
			{ schema },
		);

		expect(result.data).toEqual({ name: "Direct" });
	});

	it("preserves extra input fields", async () => {
		const binding = createMockBinding({ response: '{"name":"test"}' });
		const schema = nameSchema();

		await structuredAI(
			binding,
			"model",
			{
				messages: [{ role: "user", content: "test" }],
				temperature: 0.5,
				max_tokens: 100,
			},
			{ schema },
		);

		const sentInput = binding.calls[0].inputs;
		expect(sentInput.temperature).toBe(0.5);
		expect(sentInput.max_tokens).toBe(100);
	});
});
