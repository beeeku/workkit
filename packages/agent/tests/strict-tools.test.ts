import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent";
import { OffPaletteToolError } from "../src/errors";
import type { AgentEvent } from "../src/events";
import { tool } from "../src/tool";
import { call, mockGateway } from "./_mocks";

describe("strictTools mode", () => {
	it("default strictTools=false preserves soft unknown-tool behavior", async () => {
		const { gateway } = mockGateway([{ toolCalls: [call("not-a-tool")] }, { text: "moved on" }]);
		const agent = defineAgent({
			name: "strict-default",
			model: "m",
			provider: gateway,
		});
		const result = await agent.run({ messages: [{ role: "user", content: "go" }] });
		expect(result.text).toBe("moved on");
		expect(result.stopReason).toBe("stop");
		const toolMsg = result.messages.find((m) => m.role === "tool");
		expect(toolMsg && (toolMsg as { content: string }).content).toMatch(/unknown tool/i);
	});

	it("strictTools=true throws OffPaletteToolError on unknown tool call", async () => {
		const { gateway } = mockGateway([{ toolCalls: [call("compute_greeks")] }]);
		const known = tool({
			name: "search",
			description: "searches",
			input: z.object({ q: z.string() }),
			handler: async () => "ok",
		});
		const agent = defineAgent({
			name: "strict-on-1",
			model: "m",
			provider: gateway,
			tools: [known],
			strictTools: true,
		});
		await expect(agent.run({ messages: [{ role: "user", content: "go" }] })).rejects.toBeInstanceOf(
			OffPaletteToolError,
		);
	});

	it("strictTools=true terminates loop with stopReason:'error' (via done event)", async () => {
		const { gateway } = mockGateway([{ toolCalls: [call("compute_greeks")] }]);
		const agent = defineAgent({
			name: "strict-on-2",
			model: "m",
			provider: gateway,
			strictTools: true,
		});
		const events: AgentEvent[] = [];
		try {
			for await (const e of agent.stream({ messages: [{ role: "user", content: "go" }] })) {
				events.push(e);
			}
		} catch {
			// expected
		}
		const doneEvent = events.find((e) => e.type === "done");
		expect(doneEvent).toBeDefined();
		expect(doneEvent && (doneEvent as { stopReason: string }).stopReason).toBe("error");
	});

	it("strictTools=true with [unknown, known] calls does NOT execute the known tool", async () => {
		let knownCallCount = 0;
		const known = tool({
			name: "search",
			description: "searches",
			input: z.object({}),
			handler: async () => {
				knownCallCount += 1;
				return "ran";
			},
		});
		const { gateway } = mockGateway([{ toolCalls: [call("compute_greeks"), call("search")] }]);
		const agent = defineAgent({
			name: "strict-on-3",
			model: "m",
			provider: gateway,
			tools: [known],
			strictTools: true,
		});
		await expect(agent.run({ messages: [{ role: "user", content: "go" }] })).rejects.toBeInstanceOf(
			OffPaletteToolError,
		);
		expect(knownCallCount).toBe(0);
	});

	it("strictTools=true with [known, unknown] calls does NOT execute the earlier known tool either", async () => {
		// Regression guard: the rejection must pre-scan the whole turn, otherwise
		// a known tool placed *before* an off-palette one would run and leave a
		// partial side effect from a turn we're about to reject.
		let knownCallCount = 0;
		const known = tool({
			name: "search",
			description: "searches",
			input: z.object({}),
			handler: async () => {
				knownCallCount += 1;
				return "ran";
			},
		});
		const { gateway } = mockGateway([{ toolCalls: [call("search"), call("compute_greeks")] }]);
		const agent = defineAgent({
			name: "strict-on-3b",
			model: "m",
			provider: gateway,
			tools: [known],
			strictTools: true,
		});
		const events: AgentEvent[] = [];
		try {
			for await (const e of agent.stream({ messages: [{ role: "user", content: "go" }] })) {
				events.push(e);
			}
		} catch {
			// expected
		}
		expect(knownCallCount).toBe(0);
		// No tool-start should have been emitted for any call in the rejected turn,
		// so tool-start/tool-end pairs stay balanced for downstream consumers.
		expect(events.some((e) => e.type === "tool-start")).toBe(false);
	});

	it("emits a tool-rejected event with call + reason='off-palette'", async () => {
		const offPaletteCall = call("compute_greeks", { foo: 1 });
		const { gateway } = mockGateway([{ toolCalls: [offPaletteCall] }]);
		const known = tool({
			name: "search",
			description: "searches",
			input: z.object({}),
			handler: async () => "ok",
		});
		const agent = defineAgent({
			name: "strict-on-4",
			model: "m",
			provider: gateway,
			tools: [known],
			strictTools: true,
		});
		const events: AgentEvent[] = [];
		try {
			for await (const e of agent.stream({ messages: [{ role: "user", content: "go" }] })) {
				events.push(e);
			}
		} catch {
			// expected
		}
		const rejected = events.find((e) => e.type === "tool-rejected");
		expect(rejected).toBeDefined();
		if (rejected && rejected.type === "tool-rejected") {
			expect(rejected.reason).toBe("off-palette");
			expect(rejected.call.name).toBe("compute_greeks");
			expect(typeof rejected.step).toBe("number");
		}
	});

	it("OffPaletteToolError carries toolName and allowedPalette", async () => {
		const { gateway } = mockGateway([{ toolCalls: [call("compute_greeks")] }]);
		const a = tool({
			name: "search",
			description: "searches",
			input: z.object({}),
			handler: async () => "ok",
		});
		const b = tool({
			name: "lookup_ticker",
			description: "looks up",
			input: z.object({}),
			handler: async () => "ok",
		});
		const agent = defineAgent({
			name: "strict-on-5",
			model: "m",
			provider: gateway,
			tools: [a, b],
			strictTools: true,
		});
		try {
			await agent.run({ messages: [{ role: "user", content: "go" }] });
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(OffPaletteToolError);
			const e = err as OffPaletteToolError;
			expect(e.toolName).toBe("compute_greeks");
			expect(e.allowedPalette).toEqual(["search", "lookup_ticker"]);
		}
	});
});
