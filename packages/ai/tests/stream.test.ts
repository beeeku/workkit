import { describe, expect, it, vi } from "vitest";
import { streamAI } from "../src/stream";
import type { AiBinding } from "../src/types";

function createStreamBinding(chunks: string[]): AiBinding {
	return {
		async run(_model: string, inputs: Record<string, unknown>) {
			// Verify stream flag is set
			if (!inputs.stream) {
				return { response: chunks.join("") };
			}

			const encoder = new TextEncoder();
			let index = 0;
			return new ReadableStream<Uint8Array>({
				pull(controller) {
					if (index < chunks.length) {
						controller.enqueue(encoder.encode(chunks[index]));
						index++;
					} else {
						controller.close();
					}
				},
			});
		},
	};
}

function createErrorBinding(error: Error): AiBinding {
	return {
		async run() {
			throw error;
		},
	};
}

function createStringBinding(text: string): AiBinding {
	return {
		async run() {
			return text;
		},
	};
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let result = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		result += decoder.decode(value, { stream: true });
	}
	return result;
}

describe("streamAI()", () => {
	describe("binding validation", () => {
		it("throws BindingNotFoundError when binding is null", async () => {
			await expect(
				streamAI(null as unknown as AiBinding, "@cf/meta/llama-3.1-8b-instruct", {
					messages: [{ role: "user", content: "Hello" }],
				}),
			).rejects.toThrow("AI");
		});

		it("throws BindingNotFoundError when binding is undefined", async () => {
			await expect(
				streamAI(undefined as unknown as AiBinding, "@cf/meta/llama-3.1-8b-instruct", {
					messages: [{ role: "user", content: "Hello" }],
				}),
			).rejects.toThrow("AI");
		});
	});

	describe("stream creation", () => {
		it("returns a ReadableStream", async () => {
			const binding = createStreamBinding(["Hello", " ", "World"]);
			const stream = await streamAI(binding, "@cf/meta/llama-3.1-8b-instruct", {
				messages: [{ role: "user", content: "Hello" }],
			});

			expect(stream).toBeInstanceOf(ReadableStream);
		});

		it("sets stream flag in input automatically", async () => {
			const calls: Record<string, unknown>[] = [];
			const binding: AiBinding = {
				async run(_model, inputs) {
					calls.push(inputs);
					return new ReadableStream({
						start(controller) {
							controller.close();
						},
					});
				},
			};

			await streamAI(binding, "@cf/meta/llama-3.1-8b-instruct", {
				messages: [{ role: "user", content: "Hello" }],
			});

			expect(calls[0]).toHaveProperty("stream", true);
		});

		it("does not mutate the original input", async () => {
			const binding = createStreamBinding([]);
			const input = {
				messages: [{ role: "user" as const, content: "Hello" }],
			};

			await streamAI(binding, "@cf/meta/llama-3.1-8b-instruct", input);

			expect(input).not.toHaveProperty("stream");
		});
	});

	describe("stream reading", () => {
		it("yields all text chunks", async () => {
			const binding = createStreamBinding(["Hello", ", ", "World", "!"]);
			const stream = await streamAI(binding, "@cf/meta/llama-3.1-8b-instruct", {
				messages: [{ role: "user", content: "Write something" }],
			});

			const text = await readStream(stream);
			expect(text).toBe("Hello, World!");
		});

		it("handles a single chunk", async () => {
			const binding = createStreamBinding(["Complete response"]);
			const stream = await streamAI(binding, "@cf/meta/llama-3.1-8b-instruct", {
				messages: [{ role: "user", content: "Hello" }],
			});

			const text = await readStream(stream);
			expect(text).toBe("Complete response");
		});

		it("handles empty chunks", async () => {
			const binding = createStreamBinding([]);
			const stream = await streamAI(binding, "@cf/meta/llama-3.1-8b-instruct", {
				messages: [{ role: "user", content: "Hello" }],
			});

			const text = await readStream(stream);
			expect(text).toBe("");
		});
	});

	describe("non-stream response wrapping", () => {
		it("wraps a string response into a ReadableStream", async () => {
			const binding = createStringBinding("Plain text response");
			const stream = await streamAI(binding, "@cf/meta/llama-3.1-8b-instruct", {
				messages: [{ role: "user", content: "Hello" }],
			});

			const text = await readStream(stream);
			expect(text).toBe("Plain text response");
		});

		it("wraps an object response as JSON into a ReadableStream", async () => {
			const binding: AiBinding = {
				async run() {
					return { response: "Object response" };
				},
			};
			const stream = await streamAI(binding, "@cf/meta/llama-3.1-8b-instruct", {
				messages: [{ role: "user", content: "Hello" }],
			});

			const text = await readStream(stream);
			expect(JSON.parse(text)).toEqual({ response: "Object response" });
		});
	});

	describe("error handling", () => {
		it("propagates binding errors", async () => {
			const binding = createErrorBinding(new Error("Model not available"));

			await expect(
				streamAI(binding, "@cf/meta/llama-3.1-8b-instruct", {
					messages: [{ role: "user", content: "Hello" }],
				}),
			).rejects.toThrow("Model not available");
		});
	});

	describe("gateway options", () => {
		it("passes gateway config to the binding", async () => {
			const calls: Record<string, unknown>[] = [];
			const binding: AiBinding = {
				async run(_model, _inputs, options) {
					calls.push(options ?? {});
					return new ReadableStream({
						start(controller) {
							controller.close();
						},
					});
				},
			};

			await streamAI(
				binding,
				"@cf/meta/llama-3.1-8b-instruct",
				{
					messages: [{ role: "user", content: "Hello" }],
				},
				{
					gateway: { id: "my-gw" },
				},
			);

			expect(calls[0]).toHaveProperty("gateway", { id: "my-gw" });
		});
	});

	describe("timeout handling", () => {
		it("wraps stream with timeout cleanup", async () => {
			const binding = createStreamBinding(["Hello"]);
			const stream = await streamAI(
				binding,
				"@cf/meta/llama-3.1-8b-instruct",
				{
					messages: [{ role: "user", content: "Hello" }],
				},
				{
					timeout: 5000,
				},
			);

			const text = await readStream(stream);
			expect(text).toBe("Hello");
		});
	});

	describe("abort signal", () => {
		it("handles pre-aborted signal", async () => {
			const binding = createStreamBinding(["Hello"]);
			const controller = new AbortController();
			controller.abort();

			// The binding should receive an aborted signal
			// Behavior depends on binding implementation
			const stream = await streamAI(
				binding,
				"@cf/meta/llama-3.1-8b-instruct",
				{
					messages: [{ role: "user", content: "Hello" }],
				},
				{
					signal: controller.signal,
				},
			);

			expect(stream).toBeInstanceOf(ReadableStream);
		});
	});
});
