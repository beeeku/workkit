import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent";
import { tool } from "../src/tool";
import { call, mockGateway } from "./_mocks";

function searchTool(
	handler: (input: { q: string }) => Promise<string> = async () => "search-result",
) {
	return tool({
		name: "search",
		description: "searches",
		input: z.object({ q: z.string() }),
		handler,
	});
}

describe("forceTextAfterTool option", () => {
	it("default (false): toolChoice stays 'auto' on the post-tool step", async () => {
		const { gateway, state } = mockGateway([
			{ toolCalls: [call("search", { q: "x" })] },
			{ text: "done" },
		]);
		const agent = defineAgent({
			name: "default",
			model: "m",
			provider: gateway,
			tools: [searchTool()],
			stopWhen: { maxSteps: 3 },
		});

		const result = await agent.run({ messages: [{ role: "user", content: "go" }] });

		expect(result.text).toBe("done");
		expect(state.calls).toHaveLength(2);
		expect(state.calls[0]?.options?.toolOptions?.toolChoice).toBe("auto");
		expect(state.calls[1]?.options?.toolOptions?.toolChoice).toBe("auto");
	});

	it("forceTextAfterTool=true: post-tool step uses toolChoice 'none'", async () => {
		const { gateway, state } = mockGateway([
			{ toolCalls: [call("search", { q: "x" })] },
			{ text: "synthesized answer" },
		]);
		const agent = defineAgent({
			name: "force-text",
			model: "m",
			provider: gateway,
			tools: [searchTool()],
			forceTextAfterTool: true,
			stopWhen: { maxSteps: 3 },
		});

		const result = await agent.run({ messages: [{ role: "user", content: "go" }] });

		expect(result.text).toBe("synthesized answer");
		expect(result.stopReason).toBe("stop");
		expect(state.calls).toHaveLength(2);
		// First step: tool palette open.
		expect(state.calls[0]?.options?.toolOptions?.toolChoice).toBe("auto");
		// Post-tool step: tools still in the message but toolChoice='none'.
		expect(state.calls[1]?.options?.toolOptions?.toolChoice).toBe("none");
		expect(state.calls[1]?.options?.toolOptions?.tools?.length).toBe(1);
	});

	it("forceTextAfterTool only forces the IMMEDIATE next step, not all subsequent steps", async () => {
		// tool → text-blocked → another text → user could continue but loop stops at no-tool.
		// This case is mostly defensive: after the post-tool 'none' step emits text and we stop,
		// there are no further model calls. So we test the 3-step shape with two tool turns:
		//   step 1: tool → step 2: text-only ('none') → STOP
		// And verify a fresh agent call resets the post-tool flag (not carried across runs).
		const { gateway, state } = mockGateway([
			{ toolCalls: [call("search", { q: "x" })] },
			{ text: "first answer" },
			{ toolCalls: [call("search", { q: "y" })] },
			{ text: "second answer" },
		]);
		const agent = defineAgent({
			name: "fresh-run",
			model: "m",
			provider: gateway,
			tools: [searchTool()],
			forceTextAfterTool: true,
			stopWhen: { maxSteps: 3 },
		});

		await agent.run({ messages: [{ role: "user", content: "first" }] });
		await agent.run({ messages: [{ role: "user", content: "second" }] });

		expect(state.calls).toHaveLength(4);
		// Run 1: auto, none.
		expect(state.calls[0]?.options?.toolOptions?.toolChoice).toBe("auto");
		expect(state.calls[1]?.options?.toolOptions?.toolChoice).toBe("none");
		// Run 2 starts fresh: auto, none.
		expect(state.calls[2]?.options?.toolOptions?.toolChoice).toBe("auto");
		expect(state.calls[3]?.options?.toolOptions?.toolChoice).toBe("none");
	});

	it("when tools array is empty, forceTextAfterTool is a no-op (no toolOptions)", async () => {
		const { gateway, state } = mockGateway([{ text: "ok" }]);
		const agent = defineAgent({
			name: "no-tools",
			model: "m",
			provider: gateway,
			forceTextAfterTool: true,
		});

		await agent.run({ messages: [{ role: "user", content: "go" }] });

		expect(state.calls[0]?.options?.toolOptions).toBeUndefined();
	});

	it("afterModel retry on the post-tool step preserves toolChoice='none'", async () => {
		// Step 1: tool call. Step 2: post-tool, model returns text. afterModel
		// rejects the first text, retries → step 2-retry should ALSO use 'none',
		// otherwise the retry would re-enable tool calls and the whole point
		// of forceTextAfterTool is undermined.
		let afterModelCalls = 0;
		const { gateway, state } = mockGateway([
			{ toolCalls: [call("search", { q: "x" })] },
			{ text: "first text (rejected)" },
			{ text: "retry text (accepted)" },
		]);
		const agent = defineAgent({
			name: "retry-keeps-none",
			model: "m",
			provider: gateway,
			tools: [searchTool()],
			forceTextAfterTool: true,
			stopWhen: { maxSteps: 4 },
			hooks: {
				afterModel: () => {
					afterModelCalls += 1;
					return afterModelCalls === 2 ? { retry: true, reminder: "try again" } : undefined;
				},
			},
		});

		await agent.run({ messages: [{ role: "user", content: "go" }] });

		// step 1 (tool=auto), step 2 (tool=none, rejected), step 2-retry (tool=none, accepted)
		expect(state.calls.map((c) => c.options?.toolOptions?.toolChoice)).toEqual([
			"auto",
			"none",
			"none",
		]);
	});
});
