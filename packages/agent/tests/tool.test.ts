import { TimeoutError } from "@workkit/errors";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolValidationError } from "../src/errors";
import { runTool, tool } from "../src/tool";
import type { ToolCtx } from "../src/types";

const ctx: ToolCtx = {
	id: "call_1",
	agentPath: ["a"],
	usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
};

describe("tool() validation", () => {
	it("validates input via Zod and passes typed args to the handler", async () => {
		const t = tool({
			name: "add",
			description: "adds two numbers",
			input: z.object({ a: z.number(), b: z.number() }),
			handler: async ({ a, b }) => `${a + b}`,
		});
		const out = await runTool(t, { a: 2, b: 3 }, ctx);
		expect(out).toBe("5");
	});

	it("validates input via Valibot", async () => {
		const t = tool({
			name: "greet",
			description: "greet someone",
			input: v.object({ name: v.string() }),
			handler: async ({ name }) => `hi ${name}`,
		});
		const out = await runTool(t, { name: "Bikash" }, ctx);
		expect(out).toBe("hi Bikash");
	});

	it("throws ToolValidationError when Zod input is bad", async () => {
		const t = tool({
			name: "add",
			description: "adds",
			input: z.object({ a: z.number(), b: z.number() }),
			handler: async () => "ok",
		});
		await expect(runTool(t, { a: "not-a-number", b: 3 }, ctx)).rejects.toBeInstanceOf(
			ToolValidationError,
		);
	});

	it("throws ToolValidationError when Valibot input is bad", async () => {
		const t = tool({
			name: "greet",
			description: "greet",
			input: v.object({ name: v.string() }),
			handler: async () => "ok",
		});
		await expect(runTool(t, { name: 42 }, ctx)).rejects.toBeInstanceOf(ToolValidationError);
	});

	it("rejects illegal tool names at definition time", () => {
		expect(() =>
			tool({
				name: "1bad",
				description: "x",
				input: z.object({}),
				handler: async () => "x",
			}),
		).toThrow();
		expect(() =>
			tool({
				name: "spaces in name",
				description: "x",
				input: z.object({}),
				handler: async () => "x",
			}),
		).toThrow();
	});

	it("enforces per-tool timeout", async () => {
		const t = tool({
			name: "slow",
			description: "slow",
			input: z.object({}),
			timeoutMs: 30,
			handler: () => new Promise((resolve) => setTimeout(() => resolve("late"), 200)),
		});
		await expect(runTool(t, {}, ctx)).rejects.toBeInstanceOf(TimeoutError);
	});

	it("validates output schema when supplied", async () => {
		const t = tool({
			name: "ret",
			description: "ret",
			input: z.object({}),
			output: z.object({ ok: z.boolean() }),
			handler: async () => ({ ok: "not-a-bool" }) as unknown as { ok: boolean },
		});
		await expect(runTool(t, {}, ctx)).rejects.toBeInstanceOf(ToolValidationError);
	});

	it("returns string result verbatim", async () => {
		const t = tool({
			name: "echo",
			description: "echo",
			input: z.object({ s: z.string() }),
			handler: async ({ s }) => s,
		});
		const out = await runTool(t, { s: "hello" }, ctx);
		expect(out).toBe("hello");
	});

	it("JSON.stringifies object output by default", async () => {
		const t = tool({
			name: "obj",
			description: "obj",
			input: z.object({}),
			handler: async () => ({ a: 1, b: "two" }),
		});
		const out = await runTool(t, {}, ctx);
		expect(JSON.parse(out)).toEqual({ a: 1, b: "two" });
	});
});
