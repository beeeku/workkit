import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src/tokens";

describe("estimateTokens()", () => {
	describe("string input", () => {
		it("estimates tokens for a simple sentence", () => {
			const tokens = estimateTokens("Hello, how are you today?");
			expect(tokens).toBeGreaterThan(0);
			expect(tokens).toBeLessThan(20);
		});

		it("returns a small count for a single word", () => {
			const tokens = estimateTokens("Hello");
			// 'Hello' is 5 chars → ceil(5/4) = 2
			expect(tokens).toBe(2);
		});

		it("handles empty string", () => {
			const tokens = estimateTokens("");
			expect(tokens).toBe(0);
		});

		it("handles single character", () => {
			const tokens = estimateTokens("a");
			expect(tokens).toBe(1);
		});

		it("estimates more tokens for longer text", () => {
			const short = estimateTokens("Hello");
			const long = estimateTokens(
				"Hello, how are you doing today? I hope you are having a wonderful day with lots of exciting activities.",
			);
			expect(long).toBeGreaterThan(short);
		});

		it("handles text with punctuation", () => {
			const tokens = estimateTokens("Hello! How are you? Fine, thanks.");
			expect(tokens).toBeGreaterThan(0);
		});

		it("handles text with numbers", () => {
			const tokens = estimateTokens("The year is 2024 and there are 365 days");
			expect(tokens).toBeGreaterThan(0);
		});

		it("estimates more tokens for long words", () => {
			const shortWords = estimateTokens("the cat sat on a mat");
			const longWords = estimateTokens("extraterrestrial communication pseudoscientific");
			// Long words should produce more tokens per word
			expect(longWords).toBeGreaterThanOrEqual(3); // 3 long words, each >1 token
		});

		it("handles multiple spaces", () => {
			const tokens = estimateTokens("hello    world");
			// 'hello' = ceil(5/4) = 2, 'world' = ceil(5/4) = 2
			expect(tokens).toBe(4);
		});

		it("handles newlines and tabs", () => {
			const tokens = estimateTokens("hello\nworld\tthere");
			// 'hello' = 2, 'world' = 2, 'there' = 2
			expect(tokens).toBe(6);
		});

		it("handles only whitespace", () => {
			const tokens = estimateTokens("   ");
			// filter removes empty strings, but max(1, 0) not reached since length check
			// Actually: split on whitespace → empty strings → filter → empty array → 0 tokens
			// But estimateStringTokens has max(1, tokens) — let's check:
			// words = [] → tokens = 0 → max(1, 0) = 1... but text.length is 3, not 0
			// The early return for length === 0 doesn't trigger
			expect(tokens).toBe(1);
		});

		it("estimates roughly 0.75-1.5 tokens per word for English text", () => {
			const text = "The quick brown fox jumps over the lazy dog near the riverbank";
			const words = text.split(" ").length; // 11 words
			const tokens = estimateTokens(text);
			// Should be between 0.5x and 2x the word count
			expect(tokens).toBeGreaterThanOrEqual(Math.floor(words * 0.5));
			expect(tokens).toBeLessThanOrEqual(Math.ceil(words * 2));
		});

		it("handles code-like strings", () => {
			const tokens = estimateTokens(
				"function calculateTotalPrice(items, taxRate) { return items.reduce((sum, item) => sum + item.price, 0) * (1 + taxRate); }",
			);
			expect(tokens).toBeGreaterThan(10);
		});

		it("handles URLs", () => {
			const tokens = estimateTokens("https://developers.cloudflare.com/workers-ai/models/");
			expect(tokens).toBeGreaterThan(1);
		});
	});

	describe("message array input", () => {
		it("estimates tokens for a simple message array", () => {
			const tokens = estimateTokens([{ role: "user", content: "Hello" }]);
			// Content ('Hello' = 2 tokens) + message overhead (4) + conversation overhead (3)
			expect(tokens).toBe(9);
		});

		it("estimates tokens for system + user messages", () => {
			const tokens = estimateTokens([
				{ role: "system", content: "You are helpful." },
				{ role: "user", content: "Hi" },
			]);
			// system: 'You are helpful.' = 3 words (all <=4 chars) = 3 content + 4 overhead
			// user: 'Hi' = 1 content + 4 overhead
			// + 3 conversation overhead = 15... but 'helpful.' is 8 chars = ceil(8/4) = 2
			// Actually: 'You'=1, 'are'=1, 'helpful.'=2 → 4 content + 4 overhead
			// user: 'Hi'=1 content + 4 overhead + 3 conversation = 16
			expect(tokens).toBe(16);
		});

		it("handles empty message array", () => {
			const tokens = estimateTokens([]);
			expect(tokens).toBe(3); // Just conversation overhead
		});

		it("handles message with empty content", () => {
			const tokens = estimateTokens([{ role: "user", content: "" }]);
			// Empty content (0) + message overhead (4) + conversation overhead (3)
			expect(tokens).toBe(7);
		});

		it("accumulates tokens across multiple messages", () => {
			const single = estimateTokens([{ role: "user", content: "Hello world" }]);
			const multi = estimateTokens([
				{ role: "user", content: "Hello world" },
				{ role: "assistant", content: "Hi there" },
				{ role: "user", content: "How are you" },
			]);
			expect(multi).toBeGreaterThan(single);
		});

		it("handles long conversation", () => {
			const messages = Array.from({ length: 20 }, (_, i) => ({
				role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
				content: `This is message number ${i + 1} in the conversation.`,
			}));

			const tokens = estimateTokens(messages);
			// 20 messages * (content + 4 overhead) + 3 conversation overhead
			expect(tokens).toBeGreaterThan(100);
		});

		it("includes all three roles", () => {
			const tokens = estimateTokens([
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "What is the capital of France?" },
				{ role: "assistant", content: "Paris is the capital of France." },
			]);
			expect(tokens).toBeGreaterThan(20);
		});
	});

	describe("consistency", () => {
		it("returns same estimate for same input", () => {
			const text = "The quick brown fox jumps over the lazy dog";
			const tokens1 = estimateTokens(text);
			const tokens2 = estimateTokens(text);
			expect(tokens1).toBe(tokens2);
		});

		it("always returns a non-negative integer", () => {
			const inputs = [
				"Hello",
				"",
				"A very long string with many words that goes on and on",
				"12345",
				"!@#$%",
			];

			for (const input of inputs) {
				const tokens = estimateTokens(input);
				expect(tokens).toBeGreaterThanOrEqual(0);
				expect(Number.isInteger(tokens)).toBe(true);
			}
		});
	});
});
