// --- Provider types ---

/** Workers AI binding — the `env.AI` object */
export interface WorkersAiBinding {
	run(model: string, inputs: unknown): Promise<unknown>;
}

/** Provider type discriminator */
export type ProviderType = "workers-ai" | "openai" | "anthropic" | "custom";

/** Base provider config shared by all types */
interface BaseProviderConfig {
	type: ProviderType;
}

/** Workers AI uses a binding (env.AI) */
export interface WorkersAiProviderConfig extends BaseProviderConfig {
	type: "workers-ai";
	binding: WorkersAiBinding;
}

/** OpenAI-compatible provider */
export interface OpenAiProviderConfig extends BaseProviderConfig {
	type: "openai";
	apiKey: string;
	baseUrl?: string;
}

/** Anthropic provider */
export interface AnthropicProviderConfig extends BaseProviderConfig {
	type: "anthropic";
	apiKey: string;
	baseUrl?: string;
}

/** Custom provider with user-defined run function */
export interface CustomProviderConfig extends BaseProviderConfig {
	type: "custom";
	run: (model: string, input: AiInput) => Promise<AiOutput>;
}

/** Union of all provider configs */
export type ProviderConfig =
	| WorkersAiProviderConfig
	| OpenAiProviderConfig
	| AnthropicProviderConfig
	| CustomProviderConfig;

// --- Gateway types ---

/** Map of provider name → config */
export type ProviderMap = Record<string, ProviderConfig>;

/** Gateway configuration */
export interface GatewayConfig<P extends ProviderMap = ProviderMap> {
	/** Named providers */
	providers: P;
	/** Default provider key (must exist in providers) */
	defaultProvider: keyof P & string;
}

/** Standard chat message format */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

/** Input to a model run — chat messages or raw prompt */
export type AiInput = { messages: ChatMessage[] } | { prompt: string } | Record<string, unknown>;

/** Standard output from a model run */
export interface AiOutput {
	/** Generated text (for chat/completion) */
	text?: string;
	/** Raw response from the provider */
	raw: unknown;
	/** Token usage if available */
	usage?: TokenUsage;
	/** Provider that handled the request */
	provider: string;
	/** Model used */
	model: string;
}

/** Token usage stats */
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens?: number;
}

/** Gateway instance */
export interface Gateway {
	/** Run a model with the given input */
	run(model: string, input: AiInput, options?: RunOptions): Promise<AiOutput>;
	/** List configured providers */
	providers(): string[];
	/** Get the default provider name */
	defaultProvider(): string;
}

/** Options for a single run */
export interface RunOptions {
	/** Override provider for this request */
	provider?: string;
	/** Request timeout in ms */
	timeout?: number;
	/** Abort signal */
	signal?: AbortSignal;
	/**
	 * Request structured JSON output from the model.
	 *
	 * - `"json"` — ask the model to return valid JSON (provider-specific format hint)
	 * - `{ jsonSchema: ... }` — provide a JSON Schema; providers that support strict
	 *   schema enforcement (e.g. OpenAI) will use it, others fall back to instruction-based
	 */
	responseFormat?: "json" | { jsonSchema: Record<string, unknown> };
}

// --- Router types ---

/** A routing rule: model pattern → provider name */
export interface Route {
	/** Glob-like pattern — supports `*` wildcard */
	pattern: string;
	/** Provider key to route to */
	provider: string;
}

/** Router configuration */
export interface RouterConfig {
	/** Ordered list of routes (first match wins) */
	routes: Route[];
	/** Fallback provider when no route matches */
	fallback: string;
}

/** Router instance */
export interface Router {
	/** Resolve a model name to a provider key */
	resolve(model: string): string;
	/** List all routes */
	routes(): readonly Route[];
}

// --- Cost tracking types ---

/** Pricing for a single model (per 1K tokens) */
export interface ModelPricing {
	input: number;
	output: number;
}

/** Cost tracker configuration */
export interface CostTrackerConfig {
	/** Model name → pricing */
	pricing: Record<string, ModelPricing>;
}

/** Recorded usage for cost calculation */
export interface UsageRecord {
	inputTokens: number;
	outputTokens: number;
}

/** Cost summary per model */
export interface ModelCostSummary {
	inputCost: number;
	outputCost: number;
	totalCost: number;
	inputTokens: number;
	outputTokens: number;
	requests: number;
}

/** Total cost summary */
export interface CostSummary {
	totalCost: number;
	byModel: Record<string, ModelCostSummary>;
}

/** Budget check result */
export interface BudgetCheck {
	remaining: number;
	exceeded: boolean;
	totalSpent: number;
}

/** Cost tracker instance */
export interface CostTracker {
	/** Record usage for a model */
	record(model: string, usage: UsageRecord): void;
	/** Get total cost summary */
	getTotal(): CostSummary;
	/** Check remaining budget */
	checkBudget(budget: number): BudgetCheck;
	/** Reset all tracked costs */
	reset(): void;
}

// --- Cache types ---

/** Minimal KV-like interface for cache storage */
export interface CacheStorage {
	get(key: string, options?: { type?: string }): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
}

/** Cache configuration */
export interface CacheConfig {
	/** KV namespace or compatible storage for cached responses */
	storage: CacheStorage;
	/** TTL in seconds (default: 3600) */
	ttl?: number;
	/** Custom hash function for cache key generation */
	hashFn?: (model: string, input: AiInput) => string;
}

/** A cached gateway — same interface as Gateway */
export interface CachedGateway extends Gateway {
	/** Check if a response is cached for the given model + input */
	isCached(model: string, input: AiInput): Promise<boolean>;
	/** Invalidate cached response for the given model + input */
	invalidate(model: string, input: AiInput): Promise<void>;
}

// --- Logging types ---

/** Logging hooks */
export interface LoggingConfig {
	onRequest?: (model: string, input: AiInput) => void;
	onResponse?: (model: string, output: AiOutput, durationMs: number) => void;
	onError?: (model: string, error: unknown) => void;
}

/** A logged gateway — same interface as Gateway */
export type LoggedGateway = Gateway;
