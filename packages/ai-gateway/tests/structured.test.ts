import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway";

const TEST_PROVIDER_KEY = "test-key-not-real"; // not a real secret — test fixture

// ─── Mock helpers ────────────────────────────────────────────

function createMockWorkersAi(response: unknown = { response: "Hello from Workers AI" }) {
	return {
		run: vi.fn().mockResolvedValue(response),
	};
}

// Mock global fetch for OpenAI and Anthropic tests
function mockFetch(body: Record<string, unknown>, status = 200) {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	});
}

// ─── Workers AI ──────────────────────────────────────────────

describe("responseFormat — workers-ai provider", () => {
	it("adds response_format to Workers AI input with 'json'", async () => {
		const mockAi = createMockWorkersAi();
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: mockAi } },
			defaultProvider: "ai",
		});

		await gw.run("model", { prompt: "test" }, { responseFormat: "json" });

		expect(mockAi.run).toHaveBeenCalledTimes(1);
		const calledInput = mockAi.run.mock.calls[0][1];
		expect(calledInput.response_format).toEqual({ type: "json_object" });
	});

	it("adds response_format to Workers AI input with jsonSchema", async () => {
		const mockAi = createMockWorkersAi();
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: mockAi } },
			defaultProvider: "ai",
		});

		const jsonSchema = { type: "object", properties: { name: { type: "string" } } };
		await gw.run("model", { prompt: "test" }, { responseFormat: { jsonSchema } });

		const calledInput = mockAi.run.mock.calls[0][1];
		expect(calledInput.response_format).toEqual({ type: "json_object" });
	});

	it("does not add response_format when responseFormat is not set", async () => {
		const mockAi = createMockWorkersAi();
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: mockAi } },
			defaultProvider: "ai",
		});

		await gw.run("model", { prompt: "test" });

		const calledInput = mockAi.run.mock.calls[0][1];
		expect(calledInput.response_format).toBeUndefined();
	});
});

// ─── OpenAI ──────────────────────────────────────────────────

describe("responseFormat — openai provider", () => {
	it("adds json_object response_format for 'json' mode", async () => {
		const fetchMock = mockFetch({
			choices: [{ message: { content: '{"result":"ok"}' } }],
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: TEST_PROVIDER_KEY } },
			defaultProvider: "openai",
		});

		await gw.run("gpt-4", { prompt: "test" }, { responseFormat: "json" });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(calledBody.response_format).toEqual({ type: "json_object" });
	});

	it("adds json_schema response_format with schema for jsonSchema mode", async () => {
		const fetchMock = mockFetch({
			choices: [{ message: { content: '{"name":"Alice"}' } }],
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: TEST_PROVIDER_KEY } },
			defaultProvider: "openai",
		});

		const jsonSchema = { type: "object", properties: { name: { type: "string" } } };
		await gw.run("gpt-4", { prompt: "test" }, { responseFormat: { jsonSchema } });

		const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(calledBody.response_format).toEqual({
			type: "json_schema",
			json_schema: { name: "response", schema: jsonSchema, strict: true },
		});
	});

	it("does not add response_format when not specified", async () => {
		const fetchMock = mockFetch({
			choices: [{ message: { content: "plain text" } }],
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: TEST_PROVIDER_KEY } },
			defaultProvider: "openai",
		});

		await gw.run("gpt-4", { prompt: "test" });

		const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(calledBody.response_format).toBeUndefined();
	});
});

// ─── Anthropic ───────────────────────────────────────────────

describe("responseFormat — anthropic provider", () => {
	it("adds system instruction for 'json' mode", async () => {
		const fetchMock = mockFetch({
			content: [{ text: '{"result":"ok"}' }],
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: TEST_PROVIDER_KEY } },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-3-5-sonnet-20241022", { prompt: "test" }, { responseFormat: "json" });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(calledBody.system).toContain("valid JSON");
	});

	it("adds system instruction with schema for jsonSchema mode", async () => {
		const fetchMock = mockFetch({
			content: [{ text: '{"name":"Alice"}' }],
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: TEST_PROVIDER_KEY } },
			defaultProvider: "anthropic",
		});

		const jsonSchema = { type: "object", properties: { name: { type: "string" } } };
		await gw.run(
			"claude-3-5-sonnet-20241022",
			{ prompt: "test" },
			{ responseFormat: { jsonSchema } },
		);

		const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(calledBody.system).toContain("JSON Schema");
		expect(calledBody.system).toContain('"type":"object"');
	});

	it("combines JSON instruction with existing system message", async () => {
		const fetchMock = mockFetch({
			content: [{ text: '{"answer":"42"}' }],
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: TEST_PROVIDER_KEY } },
			defaultProvider: "anthropic",
		});

		await gw.run(
			"claude-3-5-sonnet-20241022",
			{
				messages: [
					{ role: "system", content: "You are a math tutor." },
					{ role: "user", content: "What is 6 * 7?" },
				],
			},
			{ responseFormat: "json" },
		);

		const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		// Should contain both the JSON instruction and the original system message
		expect(calledBody.system).toContain("valid JSON");
		expect(calledBody.system).toContain("math tutor");
	});

	it("does not add system instruction when responseFormat is not set", async () => {
		const fetchMock = mockFetch({
			content: [{ text: "plain text" }],
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: TEST_PROVIDER_KEY } },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-3-5-sonnet-20241022", { prompt: "test" });

		const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(calledBody.system).toBeUndefined();
	});
});
