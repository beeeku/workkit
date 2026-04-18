import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent";
import { tool } from "../src/tool";
import { call, mockStreamingGateway } from "./_mocks";

describe("agent.stream() — provider.stream forwarding", () => {
	it("emits one text-delta per streamed chunk when provider.stream is available", async () => {
		const { gateway, state } = mockStreamingGateway([{ chunks: ["Hel", "lo ", "world"] }]);
		const agent = defineAgent({ name: "stream-chunks", model: "m", provider: gateway });

		const deltas: string[] = [];
		for await (const e of agent.stream({ messages: [{ role: "user", content: "hi" }] })) {
			if (e.type === "text-delta") deltas.push(e.delta);
		}

		expect(deltas).toEqual(["Hel", "lo ", "world"]);
		expect(state.streamCalls).toBe(1);
		expect(state.runCalls).toBe(0);
	});

	it("routes tool_use events from the stream into the loop's tool dispatch", async () => {
		const { gateway } = mockStreamingGateway([
			{ chunks: ["thinking..."], toolCalls: [call("ping")] },
			{ chunks: ["done"] },
		]);
		const ping = tool({
			name: "ping",
			description: "ping",
			input: z.object({}),
			handler: async () => "pong",
		});
		const agent = defineAgent({
			name: "stream-tooluse",
			model: "m",
			provider: gateway,
			tools: [ping],
		});

		const types: string[] = [];
		for await (const e of agent.stream({ messages: [{ role: "user", content: "hi" }] })) {
			types.push(e.type);
		}

		expect(types).toContain("tool-start");
		expect(types).toContain("tool-end");
		expect(types[types.length - 1]).toBe("done");
	});

	it("falls back to provider.run (and a single text-delta) when stream is absent", async () => {
		const { gateway, state } = mockStreamingGateway([{ chunks: ["one shot"] }]);
		// Strip stream to force the fallback path.
		(gateway as { stream?: unknown }).stream = undefined;

		const agent = defineAgent({ name: "stream-fallback", model: "m", provider: gateway });
		const deltas: string[] = [];
		for await (const e of agent.stream({ messages: [{ role: "user", content: "hi" }] })) {
			if (e.type === "text-delta") deltas.push(e.delta);
		}

		expect(state.streamCalls).toBe(0);
		expect(state.runCalls).toBe(1);
		expect(deltas).toEqual(["one shot"]);
	});
});
