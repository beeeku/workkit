import { describe, expect, it, vi } from "vitest";
import {
	StructuredOutputError,
	aiWithTools,
	createToolRegistry,
	estimateTokens,
	standardSchemaToJsonSchema,
	structuredAI,
} from "../src/index";
import type { AiOutput, Gateway } from "../src/types";

/** Minimal hand-rolled Standard Schema v1 adapter for tests (mirrors @workkit/ai's). */
function createSchema<T>(
	validate: (
		value: unknown,
	) =>
		| { value: T; issues?: undefined }
		| { issues: Array<{ message: string; path?: string[] }>; value?: undefined },
	jsonSchemaOverride?: Record<string, unknown>,
): {
	"~standard": {
		version: 1;
		vendor: string;
		validate: typeof validate;
	};
	toJSONSchema?: () => Record<string, unknown>;
} {
	return {
		"~standard": { version: 1, vendor: "test", validate },
		...(jsonSchemaOverride ? { toJSONSchema: () => jsonSchemaOverride } : {}),
	};
}

function makeMockGateway(outputs: Array<Partial<AiOutput>>): Gateway & { calls: number } {
	let calls = 0;
	const gw: Gateway & { calls: number } = {
		get calls() {
			return calls;
		},
		run: vi.fn(async (_model, _input, _options) => {
			const out = outputs[Math.min(calls, outputs.length - 1)] ?? {};
			calls++;
			return {
				text: "",
				raw: {},
				provider: "mock",
				model: "m",
				...out,
			};
		}),
		providers: () => ["mock"],
		defaultProvider: () => "mock",
	};
	return gw;
}

describe("createToolRegistry()", () => {
	it("registers tools, exposes definitions, and dispatches execute()", async () => {
		const registry = createToolRegistry();
		const handler = vi.fn(async (args: Record<string, unknown>) => `result:${args.x}`);
		registry.register("echo", {
			definition: { name: "echo", description: "echo", parameters: { type: "object" } },
			handler,
		});

		expect(registry.getTools()).toEqual([
			{ name: "echo", description: "echo", parameters: { type: "object" } },
		]);
		const result = await registry.execute({ id: "c1", name: "echo", arguments: { x: 42 } });
		expect(result).toBe("result:42");
		expect(handler).toHaveBeenCalledWith({ x: 42 });
	});

	it("throws on unknown tool name", async () => {
		const registry = createToolRegistry();
		await expect(registry.execute({ id: "c1", name: "missing", arguments: {} })).rejects.toThrow(
			"Unknown tool",
		);
	});
});

describe("estimateTokens()", () => {
	it("estimates a short string", () => {
		expect(estimateTokens("hi")).toBeGreaterThan(0);
	});

	it("scales with length", () => {
		const short = estimateTokens("hi there");
		const long = estimateTokens(
			"this is a much longer prompt with lots of words to count up higher",
		);
		expect(long).toBeGreaterThan(short);
	});

	it("adds per-message overhead for chat arrays", () => {
		const raw = estimateTokens("hello world");
		const chat = estimateTokens([
			{ role: "system", content: "hello" },
			{ role: "user", content: "world" },
		]);
		expect(chat).toBeGreaterThan(raw);
	});
});

describe("standardSchemaToJsonSchema()", () => {
	it("uses the schema's toJSONSchema() when provided", () => {
		const schema = createSchema<{ name: string }>((v) => ({ value: v as { name: string } }), {
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
		});
		const json = standardSchemaToJsonSchema(schema);
		expect(json.type).toBe("object");
		expect((json.properties as Record<string, unknown>).name).toMatchObject({ type: "string" });
	});

	it("falls back to a permissive {type: 'object'} for unknown shapes", () => {
		const schema = createSchema<{ any: string }>(() => ({ issues: [{ message: "n/a" }] }));
		const json = standardSchemaToJsonSchema(schema);
		expect(json.type).toBe("object");
	});
});

describe("structuredAI()", () => {
	it("parses and validates a JSON response", async () => {
		const gw = makeMockGateway([{ text: '{"colors":["red","blue"]}' }]);
		const schema = createSchema<{ colors: string[] }>((v) => {
			if (typeof v === "object" && v !== null && Array.isArray((v as { colors: unknown }).colors)) {
				return { value: v as { colors: string[] } };
			}
			return { issues: [{ message: "expected {colors: string[]}" }] };
		});
		const result = await structuredAI(
			gw,
			"m",
			{ messages: [{ role: "user", content: "colors?" }] },
			{ schema },
		);
		expect(result.data).toEqual({ colors: ["red", "blue"] });
	});

	it("retries on invalid JSON then succeeds", async () => {
		const gw = makeMockGateway([{ text: "not json" }, { text: '{"x":1}' }]);
		const schema = createSchema<{ x: number }>((v) => {
			if (typeof v === "object" && v !== null && typeof (v as { x: unknown }).x === "number") {
				return { value: v as { x: number } };
			}
			return { issues: [{ message: "expected {x: number}" }] };
		});
		const result = await structuredAI(
			gw,
			"m",
			{ messages: [{ role: "user", content: "x?" }] },
			{ schema, maxRetries: 1 },
		);
		expect(result.data).toEqual({ x: 1 });
		expect(gw.calls).toBe(2);
	});

	it("throws StructuredOutputError when retries exhaust", async () => {
		const gw = makeMockGateway([{ text: "bad" }, { text: "still bad" }]);
		const schema = createSchema<{ x: number }>(() => ({
			issues: [{ message: "unreachable — never valid" }],
		}));
		await expect(
			structuredAI(
				gw,
				"m",
				{ messages: [{ role: "user", content: "?" }] },
				{ schema, maxRetries: 1 },
			),
		).rejects.toBeInstanceOf(StructuredOutputError);
	});
});

describe("aiWithTools()", () => {
	it("returns content immediately when no tool calls", async () => {
		const gw = makeMockGateway([{ text: "done" }]);
		const result = await aiWithTools(
			gw,
			"m",
			{ messages: [{ role: "user", content: "hi" }] },
			{ tools: [] },
		);
		expect(result.content).toBe("done");
		expect(result.toolCalls).toEqual([]);
		expect(result.turns).toBe(1);
	});

	it("dispatches tool calls via handler and loops to completion", async () => {
		const gw = makeMockGateway([
			{ toolCalls: [{ id: "c1", name: "ping", arguments: {} }] },
			{ text: "ok" },
		]);
		const handler = vi.fn(async () => "pong");
		const result = await aiWithTools(
			gw,
			"m",
			{ messages: [{ role: "user", content: "ping" }] },
			{
				tools: [{ name: "ping", description: "", parameters: { type: "object" } }],
				handler,
			},
		);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(result.content).toBe("ok");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.turns).toBe(2);
	});

	it("returns tool calls without dispatching when no handler is supplied", async () => {
		const gw = makeMockGateway([{ toolCalls: [{ id: "c1", name: "ping", arguments: {} }] }]);
		const result = await aiWithTools(
			gw,
			"m",
			{ messages: [{ role: "user", content: "ping" }] },
			{ tools: [{ name: "ping", description: "", parameters: { type: "object" } }] },
		);
		expect(result.toolCalls).toHaveLength(1);
		expect(result.turns).toBe(1);
	});

	it("stops at maxTurns", async () => {
		const gw = makeMockGateway([
			{ toolCalls: [{ id: "c1", name: "loop", arguments: {} }] },
			{ toolCalls: [{ id: "c2", name: "loop", arguments: {} }] },
			{ toolCalls: [{ id: "c3", name: "loop", arguments: {} }] },
		]);
		const result = await aiWithTools(
			gw,
			"m",
			{ messages: [{ role: "user", content: "loop" }] },
			{
				tools: [{ name: "loop", description: "", parameters: { type: "object" } }],
				handler: async () => "ok",
				maxTurns: 2,
			},
		);
		expect(result.turns).toBe(2);
		expect(result.content).toBe("");
	});
});
