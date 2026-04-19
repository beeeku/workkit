import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent";
import { OffPaletteToolError } from "../src/errors";
import type { AgentEvent } from "../src/events";
import { tool } from "../src/tool";
import type { AfterModelDecision, Message } from "../src/types";
import { call, mockGateway } from "./_mocks";

describe("afterModel hook", () => {
	it("fires on a text-only turn — hook sees the produced assistant message", async () => {
		const { gateway } = mockGateway([{ text: "hello" }]);
		const seen: Array<Extract<Message, { role: "assistant" }>> = [];
		const agent = defineAgent({
			name: "am-text-1",
			model: "m",
			provider: gateway,
			hooks: {
				afterModel: (assistant) => {
					seen.push(assistant);
				},
			},
		});
		const result = await agent.run({ messages: [{ role: "user", content: "hi" }] });
		expect(result.text).toBe("hello");
		expect(seen).toHaveLength(1);
		expect(seen[0]?.role).toBe("assistant");
		expect(seen[0]?.content).toBe("hello");
		expect(seen[0]?.tool_calls).toBeUndefined();
	});

	it("fires on a tool-call turn — hook sees the assistant message with tool_calls", async () => {
		const { gateway } = mockGateway([
			{ toolCalls: [call("search", { q: "x" })] },
			{ text: "done" },
		]);
		const search = tool({
			name: "search",
			description: "searches",
			input: z.object({ q: z.string() }),
			handler: async () => "ok",
		});
		const seen: Array<Extract<Message, { role: "assistant" }>> = [];
		const agent = defineAgent({
			name: "am-tool-1",
			model: "m",
			provider: gateway,
			tools: [search],
			hooks: {
				afterModel: (assistant) => {
					seen.push(assistant);
				},
			},
		});
		await agent.run({ messages: [{ role: "user", content: "go" }] });
		// Fires once per assistant turn — two turns total (tool-call + final text).
		expect(seen).toHaveLength(2);
		expect(seen[0]?.tool_calls?.[0]?.name).toBe("search");
		expect(seen[1]?.tool_calls).toBeUndefined();
		expect(seen[1]?.content).toBe("done");
	});

	it("retry: true with no reminder re-runs the model for the step", async () => {
		const { gateway, state } = mockGateway([{ text: "bad" }, { text: "good" }]);
		let attempts = 0;
		const agent = defineAgent({
			name: "am-retry-1",
			model: "m",
			provider: gateway,
			hooks: {
				afterModel: (): AfterModelDecision | undefined => {
					attempts += 1;
					if (attempts === 1) return { retry: true };
					return undefined;
				},
			},
		});
		const result = await agent.run({ messages: [{ role: "user", content: "hi" }] });
		expect(result.text).toBe("good");
		expect(state.calls).toHaveLength(2);
	});

	it("retry: true with reminder threads the reminder to the next model call", async () => {
		const { gateway, state } = mockGateway([{ text: "bad" }, { text: "good" }]);
		let attempts = 0;
		const REMINDER = "keep JSON strict";
		const agent = defineAgent({
			name: "am-retry-reminder-1",
			model: "m",
			provider: gateway,
			hooks: {
				afterModel: (): AfterModelDecision | undefined => {
					attempts += 1;
					if (attempts === 1) return { retry: true, reminder: REMINDER };
					return undefined;
				},
			},
		});
		const result = await agent.run({ messages: [{ role: "user", content: "hi" }] });
		expect(result.text).toBe("good");
		expect(state.calls).toHaveLength(2);
		// The retry call should include the reminder as a message before the model is re-invoked.
		const retryInput = state.calls[1]?.input as { messages: { role: string; content: string }[] };
		const hasReminder = retryInput.messages.some((m) => m.content.includes(REMINDER));
		expect(hasReminder).toBe(true);
		// The original user message is still there; the rejected assistant is not.
		expect(retryInput.messages.some((m) => m.role === "user" && m.content === "hi")).toBe(true);
		expect(retryInput.messages.every((m) => m.content !== "bad")).toBe(true);
	});

	it("tools from a rejected turn do NOT execute", async () => {
		const { gateway } = mockGateway([
			{ toolCalls: [call("search", { q: "x" })] },
			{ text: "done" },
		]);
		let searchCalls = 0;
		const search = tool({
			name: "search",
			description: "searches",
			input: z.object({ q: z.string() }),
			handler: async () => {
				searchCalls += 1;
				return "ran";
			},
		});
		let attempts = 0;
		const agent = defineAgent({
			name: "am-no-tools-1",
			model: "m",
			provider: gateway,
			tools: [search],
			hooks: {
				afterModel: (): AfterModelDecision | undefined => {
					attempts += 1;
					if (attempts === 1) return { retry: true };
					return undefined;
				},
			},
		});
		await agent.run({ messages: [{ role: "user", content: "go" }] });
		expect(searchCalls).toBe(0);
	});

	it("maxAfterModelRetries caps the retry loop — soft-fail proceeds with last message", async () => {
		const { gateway } = mockGateway([{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }]);
		const agent = defineAgent({
			name: "am-cap-1",
			model: "m",
			provider: gateway,
			maxAfterModelRetries: 2,
			hooks: {
				afterModel: () => ({ retry: true }),
			},
		});
		const events: AgentEvent[] = [];
		const result = await (async () => {
			const collected: AgentEvent[] = [];
			for await (const e of agent.stream({ messages: [{ role: "user", content: "go" }] })) {
				collected.push(e);
			}
			events.push(...collected);
			return collected;
		})();
		const retries = result.filter((e) => e.type === "after-model-retry");
		expect(retries).toHaveLength(2);
		// Soft-fail: loop proceeds with the third returned assistant message and stops normally.
		const done = events.find((e) => e.type === "done");
		expect(done).toBeDefined();
		expect(done && (done as { stopReason: string }).stopReason).toBe("stop");
	});

	it("retries consume from stopWhen.maxSteps", async () => {
		const { gateway } = mockGateway([{ text: "a" }, { text: "b" }]);
		let attempts = 0;
		const agent = defineAgent({
			name: "am-maxsteps-1",
			model: "m",
			provider: gateway,
			stopWhen: { maxSteps: 2 },
			hooks: {
				afterModel: (): AfterModelDecision | undefined => {
					attempts += 1;
					if (attempts === 1) return { retry: true };
					return undefined;
				},
			},
		});
		const result = await agent.run({ messages: [{ role: "user", content: "go" }] });
		// One retry consumed one of the two maxSteps budget slots; the second model
		// call produced "b" and the loop exits normally on a text-only step.
		expect(result.stopReason).toBe("stop");
		expect(result.text).toBe("b");
	});

	it("throw from afterModel routes through onError with kind:'hook'; abort terminates", async () => {
		const { gateway } = mockGateway([{ text: "hello" }]);
		let onErrorKind: string | undefined;
		const agent = defineAgent({
			name: "am-throw-1",
			model: "m",
			provider: gateway,
			hooks: {
				afterModel: () => {
					throw new Error("hook-boom");
				},
				onError: (err) => {
					onErrorKind = err.kind;
					return { abort: true };
				},
			},
		});
		const events: AgentEvent[] = [];
		await expect(async () => {
			for await (const e of agent.stream({ messages: [{ role: "user", content: "go" }] })) {
				events.push(e);
			}
		}).rejects.toThrow("hook-boom");
		expect(onErrorKind).toBe("hook");
		const done = events.find((e) => e.type === "done");
		expect(done && (done as { stopReason: string }).stopReason).toBe("error");
	});

	it("returning undefined or void is treated as no retry (no behavior change)", async () => {
		const { gateway, state } = mockGateway([{ text: "only" }]);
		const agent = defineAgent({
			name: "am-void-1",
			model: "m",
			provider: gateway,
			hooks: {
				afterModel: () => {
					/* void */
				},
			},
		});
		const result = await agent.run({ messages: [{ role: "user", content: "hi" }] });
		expect(result.text).toBe("only");
		expect(state.calls).toHaveLength(1);
	});

	it("emits after-model-retry events with step, attempt, and reminder fields", async () => {
		const { gateway } = mockGateway([{ text: "a" }, { text: "b" }]);
		let attempts = 0;
		const agent = defineAgent({
			name: "am-event-1",
			model: "m",
			provider: gateway,
			hooks: {
				afterModel: (): AfterModelDecision | undefined => {
					attempts += 1;
					if (attempts === 1) return { retry: true, reminder: "try again" };
					return undefined;
				},
			},
		});
		const events: AgentEvent[] = [];
		for await (const e of agent.stream({ messages: [{ role: "user", content: "go" }] })) {
			events.push(e);
		}
		const retry = events.find((e) => e.type === "after-model-retry");
		expect(retry).toBeDefined();
		if (retry && retry.type === "after-model-retry") {
			expect(retry.attempt).toBe(1);
			expect(retry.reminder).toBe("try again");
			expect(typeof retry.step).toBe("number");
		}
	});

	it("strictTools + afterModel returning no-retry still throws OffPaletteToolError", async () => {
		const { gateway } = mockGateway([{ toolCalls: [call("not-in-palette")] }]);
		const known = tool({
			name: "search",
			description: "searches",
			input: z.object({}),
			handler: async () => "ok",
		});
		const agent = defineAgent({
			name: "am-strict-1",
			model: "m",
			provider: gateway,
			tools: [known],
			strictTools: true,
			hooks: {
				afterModel: () => undefined,
			},
		});
		await expect(agent.run({ messages: [{ role: "user", content: "go" }] })).rejects.toBeInstanceOf(
			OffPaletteToolError,
		);
	});
});
