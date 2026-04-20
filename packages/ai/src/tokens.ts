import type { AiMessage } from "./types";

/**
 * Overhead tokens per message (role tags, delimiters, etc.)
 * This is a rough approximation of the overhead added by chat formatting.
 */
const MESSAGE_OVERHEAD = 4;

/**
 * Base overhead for a conversation (system prompt framing, etc.)
 */
const CONVERSATION_OVERHEAD = 3;

/**
 * Estimate token count for a string using word/character heuristics.
 *
 * This is a rough estimation — NOT a tokenizer. Different models use different
 * tokenizers (BPE, SentencePiece, etc.) so exact counts vary. This provides
 * a reasonable approximation for capacity planning and cost estimation.
 *
 * The heuristic: ~0.75 tokens per word for English text, with adjustments
 * for punctuation and special characters.
 *
 * @param input - A string or array of chat messages
 * @returns Estimated token count
 *
 * @example
 * ```ts
 * const tokens = estimateTokens('Hello, how are you today?')
 * // ~7
 *
 * const msgTokens = estimateTokens([
 *   { role: 'system', content: 'You are helpful.' },
 *   { role: 'user', content: 'Hi' },
 * ])
 * // estimates total tokens including message overhead
 * ```
 *
 * @deprecated Available identically from `@workkit/ai-gateway` — import from
 * there going forward. Per
 * [ADR-001](../../.maina/decisions/001-ai-package-consolidation.md),
 * `@workkit/ai` will be removed at v2.0; track migration via
 * [#63](https://github.com/beeeku/workkit/issues/63).
 */
export function estimateTokens(input: string | AiMessage[]): number {
	if (typeof input === "string") {
		return estimateStringTokens(input);
	}

	// Message array: sum content tokens + overhead per message + conversation overhead
	let total = CONVERSATION_OVERHEAD;

	for (const message of input) {
		total += estimateStringTokens(message.content) + MESSAGE_OVERHEAD;
	}

	return total;
}

/**
 * Estimate tokens for a raw string.
 *
 * Uses a hybrid approach:
 * 1. Split into words
 * 2. For each word, estimate tokens based on length
 * 3. Short words (~1-4 chars) are typically 1 token
 * 4. Longer words are split roughly every 4 characters
 * 5. Numbers and punctuation add tokens
 */
function estimateStringTokens(text: string): number {
	if (!text || text.length === 0) return 0;

	// Split on whitespace
	const words = text.split(/\s+/).filter((w) => w.length > 0);

	let tokens = 0;

	for (const word of words) {
		if (word.length <= 4) {
			// Short words are usually 1 token
			tokens += 1;
		} else {
			// Longer words: roughly 1 token per 4 characters
			tokens += Math.ceil(word.length / 4);
		}
	}

	return Math.max(1, tokens);
}
