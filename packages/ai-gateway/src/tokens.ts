import type { ChatMessage } from "./types";

/** Overhead tokens per message (role tags, delimiters, etc.) */
const MESSAGE_OVERHEAD = 4;

/** Base overhead for a conversation (system prompt framing, etc.) */
const CONVERSATION_OVERHEAD = 3;

/**
 * Estimate token count for a string or chat-message array using word/character
 * heuristics.
 *
 * This is a rough approximation — NOT a tokenizer. Different models use
 * different tokenizers (BPE, SentencePiece, etc.) so exact counts vary. Good
 * enough for capacity planning and cost estimation before a real call.
 *
 * The heuristic: ~1 token per short word (≤4 chars); ~1 token per 4 chars for
 * longer words; ~`MESSAGE_OVERHEAD` per message plus a `CONVERSATION_OVERHEAD`.
 *
 * @example
 * ```ts
 * estimateTokens("Hello, how are you today?")
 * // → ~7
 *
 * estimateTokens([
 *   { role: "system", content: "You are helpful." },
 *   { role: "user", content: "Hi" },
 * ])
 * // → total estimate including per-message overhead
 * ```
 */
export function estimateTokens(input: string | ChatMessage[]): number {
	if (typeof input === "string") return estimateStringTokens(input);
	let total = CONVERSATION_OVERHEAD;
	for (const message of input) {
		total += estimateStringTokens(message.content) + MESSAGE_OVERHEAD;
	}
	return total;
}

function estimateStringTokens(text: string): number {
	if (!text || text.length === 0) return 0;
	const words = text.split(/\s+/).filter((w) => w.length > 0);
	let tokens = 0;
	for (const word of words) {
		tokens += word.length <= 4 ? 1 : Math.ceil(word.length / 4);
	}
	return Math.max(1, tokens);
}
