import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent";
import { tool } from "../src/tool";
import { call, mockGateway } from "./_mocks";

describe("agent.stream()", () => {
	it("yields step-start, text-delta, step-complete, done in order for a no-tool reply", async () => {
		const { gateway } = mockGateway([{ text: "hello" }]);
		const agent = defineAgent({ name: "a-stream-1", model: "m", provider: gateway });
		const events: string[] = [];
		for await (const e of agent.stream({ messages: [{ role: "user", content: "hi" }] })) {
			events.push(e.type);
		}
		expect(events[0]).toBe("step-start");
		expect(events).toContain("text-delta");
		expect(events).toContain("step-complete");
		expect(events[events.length - 1]).toBe("done");
	});

	it("emits tool-start and tool-end around a tool call", async () => {
		const { gateway } = mockGateway([{ toolCalls: [call("ping")] }, { text: "ok" }]);
		const ping = tool({
			name: "ping",
			description: "ping",
			input: z.object({}),
			handler: async () => "pong",
		});
		const agent = defineAgent({ name: "a-stream-2", model: "m", provider: gateway, tools: [ping] });
		const events: string[] = [];
		for await (const e of agent.stream({ messages: [{ role: "user", content: "hi" }] })) {
			events.push(e.type);
		}
		expect(events.indexOf("tool-start")).toBeLessThan(events.indexOf("tool-end"));
		expect(events[events.length - 1]).toBe("done");
	});

	it("emits done with stopReason:'max_steps' when the loop is capped mid-tool-storm", async () => {
		const { gateway } = mockGateway([{ toolCalls: [call("noop")] }, { toolCalls: [call("noop")] }]);
		const noop = tool({
			name: "noop",
			description: "noop",
			input: z.object({}),
			handler: async () => "ok",
		});
		const agent = defineAgent({
			name: "a-stream-3",
			model: "m",
			provider: gateway,
			tools: [noop],
			stopWhen: { maxSteps: 1 },
		});
		const stops: string[] = [];
		for await (const e of agent.stream({ messages: [{ role: "user", content: "hi" }] })) {
			if (e.type === "done") stops.push(e.stopReason);
		}
		expect(stops).toContain("max_steps");
	});
});
