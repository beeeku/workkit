// @workkit/memory types

// Logger
export interface Logger {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

// ─── Memory Options ──────────────────────────────────────────
export interface MemoryOptions {
	db: D1Database;
	cache?: KVNamespace;
	embeddings?: Ai;
	vectorize?: VectorizeIndex;
	embeddingModel?: string;
	embeddingDimensions?: number;
	encryptionKey?: CryptoKey;
	defaultTtl?: number;
	d1ScanLimit?: number;
	decayHalfLifeDays?: number;
	logger?: Logger;
}

// ─── Fact ──────────────────────────────────────────────────────
export interface Fact {
	id: string;
	text: string;
	subject: string | null;
	source: string | null;
	tags: string[];
	confidence: number;
	encrypted: boolean;
	createdAt: number;
	validFrom: number;
	validUntil: number | null;
	supersededBy: string | null;
	forgottenAt: number | null;
	forgottenReason: string | null;
	embeddingStatus: "complete" | "pending" | "failed";
	ttl: number | null;
}

export interface FactMetadata {
	subject?: string;
	source?: string;
	tags?: string[];
	confidence?: number;
	encrypted?: boolean;
	validFrom?: number;
	supersedes?: string;
	ttl?: number;
	idempotencyKey?: string;
}

// ─── Recall ────────────────────────────────────────────────────
export interface RecallOptions {
	subject?: string;
	tags?: string[];
	timeRange?: { from?: number; to?: number };
	includeSuperseded?: boolean;
	includeForgotten?: boolean;
	limit?: number;
	threshold?: number;
	noCache?: boolean;
}

export interface RecallResult {
	fact: Fact;
	score: number;
	signals: {
		similarity: number;
		recency: number;
		confidence: number;
		metadata: number;
	};
}

// ─── Search ────────────────────────────────────────────────────
export interface SearchOptions {
	subject?: string;
	tags?: string[];
	timeRange?: { from?: number; to?: number };
	includeSuperseded?: boolean;
	includeForgotten?: boolean;
	limit?: number;
	offset?: number;
	orderBy?: "createdAt" | "validFrom" | "confidence";
	order?: "asc" | "desc";
}

// ─── Conversation ──────────────────────────────────────────────
export interface ConversationOptions {
	tokenBudget?: number;
	compaction?: "sliding-window" | "token-budget" | "summary";
	windowSize?: number;
	summaryModel?: string;
	systemPrompt?: string;
}

export interface ConversationMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	name?: string;
	metadata?: Record<string, unknown>;
}

export interface StoredMessage {
	id: string;
	conversationId: string;
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	name: string | null;
	metadata: Record<string, unknown>;
	tokenCount: number;
	createdAt: number;
	compactedInto: string | null;
}

export interface ConversationGetOptions {
	tokenBudget?: number;
	includeCompacted?: boolean;
}

export interface ConversationSnapshot {
	id: string;
	messages: StoredMessage[];
	summaries: Summary[];
	totalTokens: number;
	totalMessages: number;
	activeMessages: number;
}

export interface Summary {
	id: string;
	conversationId: string;
	content: string;
	messageRange: { from: string; to: string };
	messageCount: number;
	originalTokens: number;
	summaryTokens: number;
	createdAt: number;
}

export interface MessageListOptions {
	limit?: number;
	offset?: number;
	includeCompacted?: boolean;
}

export interface SummarizeOptions {
	keepRecent?: number;
	prompt?: string;
}

// ─── Temporal ──────────────────────────────────────────────────
export interface ScopedMemory {
	recall(query: string, options?: RecallOptions): Promise<MemoryResult<RecallResult[]>>;
	search(query: string, options?: SearchOptions): Promise<MemoryResult<Fact[]>>;
	get(factId: string): Promise<MemoryResult<Fact | null>>;
	stats(): Promise<MemoryResult<MemoryStats>>;
}

// ─── Maintenance ───────────────────────────────────────────────
export interface CompactOptions {
	mergeThreshold?: number;
	minAge?: number;
	batchSize?: number;
	dryRun?: boolean;
}

export interface CompactResult {
	mergedCount: number;
	expiredCount: number;
	reembeddedCount: number;
	durationMs: number;
}

export interface ReembedOptions {
	force?: boolean;
	batchSize?: number;
}

export interface ReembedResult {
	processedCount: number;
	failedCount: number;
	durationMs: number;
}

// ─── Stats ─────────────────────────────────────────────────────
export interface MemoryStats {
	totalFacts: number;
	activeFacts: number;
	supersededFacts: number;
	forgottenFacts: number;
	pendingEmbeddings: number;
	conversations: number;
	totalMessages: number;
	totalSummaries: number;
	mode: "d1-only" | "d1+vectorize";
	embeddingModel: string;
}

// ─── Errors ────────────────────────────────────────────────────
export type MemoryError =
	| { code: "STORAGE_ERROR"; message: string }
	| { code: "EMBEDDING_ERROR"; message: string }
	| { code: "VECTORIZE_ERROR"; message: string }
	| { code: "CACHE_ERROR"; message: string }
	| { code: "ENCRYPTION_ERROR"; message: string }
	| { code: "COMPACTION_ERROR"; message: string }
	| { code: "NOT_FOUND"; message: string }
	| { code: "IDEMPOTENCY_ERROR"; message: string };

export type MemoryResult<T> = { ok: true; value: T } | { ok: false; error: MemoryError };

// ─── Integration ───────────────────────────────────────────────
export interface InjectOptions {
	tokenBudget?: number;
	queryResolver?: (input: unknown) => string;
	subjectResolver?: (input: unknown) => string | undefined;
	tags?: string[];
	placement?: "system" | "user" | "context";
}

// ─── Conversation Interface ────────────────────────────────────
export interface Conversation {
	readonly id: string;
	add(message: ConversationMessage): Promise<MemoryResult<StoredMessage>>;
	get(options?: ConversationGetOptions): Promise<MemoryResult<ConversationSnapshot>>;
	summarize(options?: SummarizeOptions): Promise<MemoryResult<Summary>>;
	clear(): Promise<MemoryResult<void>>;
	messages(options?: MessageListOptions): Promise<MemoryResult<StoredMessage[]>>;
}

// ─── Memory Interface ──────────────────────────────────────────
export interface Memory {
	remember(fact: string, metadata?: FactMetadata): Promise<MemoryResult<Fact>>;
	rememberBatch(
		facts: Array<{ fact: string; metadata?: FactMetadata }>,
	): Promise<MemoryResult<Fact[]>>;
	recall(query: string, options?: RecallOptions): Promise<MemoryResult<RecallResult[]>>;
	search(query: string, options?: SearchOptions): Promise<MemoryResult<Fact[]>>;
	get(factId: string): Promise<MemoryResult<Fact | null>>;
	forget(factId: string, reason?: string): Promise<MemoryResult<void>>;
	supersede(
		oldFactId: string,
		newFact: string,
		metadata?: FactMetadata,
	): Promise<MemoryResult<Fact>>;
	expire(factId: string, ttlSeconds: number): Promise<MemoryResult<void>>;
	at(timestamp: number): ScopedMemory;
	conversation(id: string, options?: ConversationOptions): Conversation;
	stats(): Promise<MemoryResult<MemoryStats>>;
	compact(options?: CompactOptions): Promise<MemoryResult<CompactResult>>;
	reembed(options?: ReembedOptions): Promise<MemoryResult<ReembedResult>>;
}
