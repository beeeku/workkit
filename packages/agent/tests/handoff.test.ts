import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolNameCollisionError } from "../src/errors";
import { assertNoToolCollisions, handoff } from "../src/handoff";
import { tool } from "../src/tool";

describe("handoff()", () => {
	it("creates a synthetic tool with handoff_<name> identifier and kind:'handoff'", () => {
		const target = { name: "specialist" };
		const t = handoff(target);
		expect(t.name).toBe("handoff_specialist");
		expect(t.kind).toBe("handoff");
		expect(t.handoffTarget).toBe("specialist");
		expect(t.description).toContain("specialist");
	});

	it("includes the `when` hint in the description", () => {
		const target = { name: "fundamentals" };
		const t = handoff(target, { when: "valuation, earnings" });
		expect(t.description).toContain("valuation");
	});

	it("validates input shape (reason: string optional)", async () => {
		const t = handoff({ name: "x" });
		// missing reason — ok
		await expect(
			t.handler({} as never, {
				id: "c",
				agentPath: ["a"],
				usage: { inputTokens: 0, outputTokens: 0 },
			}),
		).resolves.toContain("x");
		// reason wrong type — should fail through the schema (validate via runTool)
		const result = await t.input["~standard"].validate({ reason: 42 });
		expect("issues" in result).toBe(true);
	});
});

describe("assertNoToolCollisions()", () => {
	it("passes when names are unique", () => {
		const a = tool({ name: "a", description: "a", input: z.object({}), handler: async () => "x" });
		const b = tool({ name: "b", description: "b", input: z.object({}), handler: async () => "x" });
		expect(() => assertNoToolCollisions([a, b])).not.toThrow();
	});

	it("throws ToolNameCollisionError on duplicates", () => {
		const a = tool({
			name: "dup",
			description: "a",
			input: z.object({}),
			handler: async () => "x",
		});
		const b = tool({
			name: "dup",
			description: "b",
			input: z.object({}),
			handler: async () => "x",
		});
		expect(() => assertNoToolCollisions([a, b])).toThrow(ToolNameCollisionError);
	});

	it("throws when a handoff name collides with a regular tool", () => {
		const t = tool({
			name: "handoff_specialist",
			description: "x",
			input: z.object({}),
			handler: async () => "x",
		});
		const h = handoff({ name: "specialist" });
		expect(() => assertNoToolCollisions([t, h])).toThrow(ToolNameCollisionError);
	});

	it("throws when an own tool collides with a tool carried by a handoff target", () => {
		const targetTool = tool({
			name: "shared",
			description: "target's tool",
			input: z.object({}),
			handler: async () => "x",
		});
		const ownTool = tool({
			name: "shared",
			description: "owner's tool",
			input: z.object({}),
			handler: async () => "x",
		});
		// Pass a stub agent shape carrying tools so handoff can record target names.
		const h = handoff({ name: "specialist", tools: [targetTool] });
		expect(() => assertNoToolCollisions([ownTool, h])).toThrow(ToolNameCollisionError);
	});
});
