// @workkit/memory — Edge-native agent memory for Cloudflare Workers

// Factory
export { createMemory } from "./memory";

// Schema
export { getSchema } from "./schema";

// Types
export type {
	Memory,
	MemoryOptions,
	Fact,
	FactMetadata,
	RecallOptions,
	RecallResult,
	SearchOptions,
	ConversationOptions,
	Conversation,
	ConversationMessage,
	StoredMessage,
	ConversationSnapshot,
	ConversationGetOptions,
	MessageListOptions,
	Summary,
	SummarizeOptions,
	ScopedMemory,
	CompactOptions,
	CompactResult,
	ReembedOptions,
	ReembedResult,
	MemoryStats,
	MemoryError,
	MemoryResult,
	InjectOptions,
	Logger,
} from "./types";

// Utilities (for advanced users)
export { cosineSimilarity, estimateTokens, extractSearchTerms } from "./utils";
export { computeScore } from "./recall";
