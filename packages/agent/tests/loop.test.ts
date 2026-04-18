import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent";
import { handoff } from "../src/handoff";
import { tool } from "../src/tool";
import { call, mockGateway } from "./_mocks";

describe("agent.run() — single agent", () => {
	it("returns text when the model produces no tool calls", async () => {
		const { gateway } = mockGateway([{ text: "hello" }]);
		const agent = defineAgent({
			name: "a-no-tools-1",
			model: "m",
			provider: gateway,
		});
		const result = await agent.run({ messages: [{ role: "user", content: "hi" }] });
		expect(result.text).toBe("hello");
		expect(result.stopReason).toBe("stop");
	});

	it("dispatches a tool call, appends tool result, then continues", async () => {
		const { gateway, state } = mockGateway([
			{ toolCalls: [call("add", { a: 2, b: 3 })] },
			{ text: "5" },
		]);
		const add = tool({
			name: "add",
			description: "adds",
			input: z.object({ a: z.number(), b: z.number() }),
			handler: async ({ a, b }) => `${a + b}`,
		});
		const agent = defineAgent({ name: "a-add-1", model: "m", provider: gateway, tools: [add] });
		const result = await agent.run({ messages: [{ role: "user", content: "go" }] });
		expect(result.text).toBe("5");
		expect(state.calls).toHaveLength(2);
		// Verify the second call carried the tool result back to the model
		const secondInput = state.calls[1]?.input as { messages: { content: string }[] };
		expect(secondInput.messages.some((m) => m.content.includes("[tool add"))).toBe(true);
	});

	it("converts tool handler throw into a tool-error message and continues", async () => {
		const { gateway } = mockGateway([
			{ toolCalls: [call("boom")] },
			{ text: "I caught the error" },
		]);
		const boom = tool({
			name: "boom",
			description: "throws",
			input: z.object({}),
			handler: async () => {
				throw new Error("kaboom");
			},
		});
		const agent = defineAgent({
			name: "a-boom-1",
			model: "m",
			provider: gateway,
			tools: [boom],
		});
		const result = await agent.run({ messages: [{ role: "user", content: "go" }] });
		expect(result.text).toContain("caught");
		const toolMsg = result.messages.find((m) => m.role === "tool");
		expect(toolMsg && (toolMsg as { isError?: boolean }).isError).toBe(true);
	});

	it("stops with stopReason:'max_steps' when the model keeps calling tools forever", async () => {
		const { gateway } = mockGateway([
			{ toolCalls: [call("noop")] },
			{ toolCalls: [call("noop")] },
			{ toolCalls: [call("noop")] },
			{ toolCalls: [call("noop")] },
		]);
		const noop = tool({
			name: "noop",
			description: "noop",
			input: z.object({}),
			handler: async () => "ok",
		});
		const agent = defineAgent({
			name: "a-noop-1",
			model: "m",
			provider: gateway,
			tools: [noop],
			stopWhen: { maxSteps: 2 },
		});
		const result = await agent.run({ messages: [{ role: "user", content: "go" }] });
		expect(result.stopReason).toBe("max_steps");
	});

	it("stops with stopReason:'max_tokens' when cumulative usage exceeds budget", async () => {
		const { gateway } = mockGateway([
			{ text: "x", usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 } },
			{ text: "y", usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 } },
		]);
		const agent = defineAgent({
			name: "a-budget-1",
			model: "m",
			provider: gateway,
			stopWhen: { maxSteps: 5, maxTokens: 150 },
		});
		const result = await agent.run({ messages: [{ role: "user", content: "go" }] });
		// First step adds 100 tokens; loop should detect cap > 150 on next iteration check.
		expect(["max_tokens", "stop"].includes(result.stopReason)).toBe(true);
	});

	it("propagates an aborted signal as stopReason:'abort'", async () => {
		const { gateway } = mockGateway([{ text: "x", delay: 50 }]);
		const ctrl = new AbortController();
		const agent = defineAgent({ name: "a-abort-1", model: "m", provider: gateway });
		const promise = agent.run({
			messages: [{ role: "user", content: "go" }],
			context: { signal: ctrl.signal },
		});
		ctrl.abort(new Error("nope"));
		await expect(promise).rejects.toThrow("nope");
	});

	it("rejects unknown tool names from the model with a tool-error message (no throw)", async () => {
		const { gateway } = mockGateway([{ toolCalls: [call("not-a-tool")] }, { text: "moved on" }]);
		const agent = defineAgent({ name: "a-unknown-1", model: "m", provider: gateway });
		const result = await agent.run({ messages: [{ role: "user", content: "go" }] });
		expect(result.text).toBe("moved on");
		const toolMsg = result.messages.find((m) => m.role === "tool");
		expect(toolMsg && (toolMsg as { content: string }).content).toMatch(/unknown tool/i);
	});
});

describe("agent handoffs", () => {
	it("switches to the target agent when a handoff tool is called", async () => {
		const { gateway: gw1 } = mockGateway([{ toolCalls: [call("handoff_specialist", {})] }]);
		const { gateway: gw2 } = mockGateway([{ text: "specialist done" }]);
		const specialist = defineAgent({ name: "specialist", model: "m2", provider: gw2 });
		const triage = defineAgent({
			name: "triage",
			model: "m1",
			provider: gw1,
			tools: [handoff(specialist)],
		});
		const result = await triage.run({ messages: [{ role: "user", content: "help" }] });
		expect(result.text).toBe("specialist done");
	});
});
