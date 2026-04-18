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
	/** Optional embedding handler. When absent, `gateway.embed()` rejects. */
	embed?: (model: string, input: EmbedInput) => Promise<EmbedOutput>;
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

/**
 * Route HTTP-based providers (OpenAI, Anthropic) through a Cloudflare AI Gateway.
 *
 * When set, the effective base URL for Anthropic becomes
 * `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/anthropic/v1`
 * and for OpenAI `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/openai`.
 *
 * An explicit `baseUrl` on a provider config overrides this. Workers AI and custom
 * providers are unaffected.
 */
export interface CfGatewayConfig {
	/** Cloudflare account id */
	accountId: string;
	/** AI Gateway id */
	gatewayId: string;
	/** Bearer token for authenticated gateways (sent as `cf-aig-authorization`) */
	authToken?: string;
	/** Per-request cache TTL in seconds (sent as `cf-aig-cache-ttl`) */
	cacheTtl?: number;
	/** Bypass the gateway cache for this request (sent as `cf-aig-skip-cache`) */
	skipCache?: boolean;
}

/** Gateway configuration */
export interface GatewayConfig<P extends ProviderMap = ProviderMap> {
	/** Named providers */
	providers: P;
	/** Default provider key (must exist in providers) */
	defaultProvider: keyof P & string;
	/** Route HTTP-based providers through a Cloudflare AI Gateway */
	cfGateway?: CfGatewayConfig;
}

/** Standard chat message format */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
	/**
	 * Hint for provider-level prompt caching. Currently only applied by the
	 * Anthropic provider, which wraps the message content in a content block
	 * with `cache_control: { type: "ephemeral" }`. Other providers ignore it.
	 */
	cacheControl?: "ephemeral";
}

// --- Tool use types ---

/** Definition of a tool that a model can call */
export interface GatewayToolDefinition {
	/** Unique name for the tool */
	name: string;
	/** Human-readable description of what the tool does */
	description: string;
	/** JSON Schema describing the tool's parameters */
	parameters: Record<string, unknown>;
}

/** A normalized tool call from any provider */
export interface GatewayToolCall {
	/** Unique identifier for this tool call */
	id: string;
	/** Name of the tool to invoke */
	name: string;
	/** Parsed arguments for the tool */
	arguments: Record<string, unknown>;
}

/** Tool use options for gateway requests */
export interface GatewayToolOptions {
	/** Tool definitions to make available to the model */
	tools: GatewayToolDefinition[];
	/** How the model should choose tools */
	toolChoice?: "auto" | "none" | "required" | { name: string };
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
	/** Tool calls from the model, if any */
	toolCalls?: GatewayToolCall[];
}

/** Token usage stats */
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens?: number;
}

/**
 * A single attempt in a CF Universal Endpoint fallback chain.
 *
 * The `provider` key must reference an `openai` or `anthropic` provider
 * in the gateway's providers map. Workers AI and custom providers are not
 * supported in the Universal Endpoint.
 */
export interface FallbackEntry {
	/** Provider name (must match a key in the providers map) */
	provider: string;
	/** Model to use for this attempt */
	model: string;
}

/** Input to an embedding request — a single string or an array to batch. */
export type EmbedInput = { text: string } | { text: string[] };

/** Output from an embedding request. */
export interface EmbedOutput {
	/** One embedding vector per input string, in input order. */
	vectors: number[][];
	/** Raw provider response for debugging. */
	raw: unknown;
	/** Token usage if the provider reports it. */
	usage?: { inputTokens: number };
	/** Provider that handled the request. */
	provider: string;
	/** Model used. */
	model: string;
}

/**
 * Unified streaming event shape across providers.
 *
 * Successful streams end with exactly one `done` event; streams that encounter
 * a mid-stream error reject the `read()` promise instead (no synthetic `done`
 * is emitted on the error path). Text generation yields
 * zero or more `text` events with `delta` token chunks. When a provider
 * completes a tool-use block mid-stream, it yields a `tool_use` event with
 * the assembled arguments (emitted today for Anthropic and OpenAI; Workers
 * AI tool-call streaming is not yet wired).
 */
export type GatewayStreamEvent =
	| { type: "text"; delta: string }
	| {
			type: "tool_use";
			id: string;
			name: string;
			input: Record<string, unknown>;
	  }
	| { type: "done"; usage?: TokenUsage; raw?: unknown };

/** Gateway instance */
export interface Gateway {
	/** Run a model with the given input */
	run(model: string, input: AiInput, options?: RunOptions): Promise<AiOutput>;
	/**
	 * Run a chain of provider/model attempts through the Cloudflare AI Gateway
	 * Universal Endpoint. The gateway tries each entry server-side in order
	 * and returns the first successful response.
	 *
	 * Optional — present on gateways returned by `createGateway` and on
	 * wrappers around them. Requires `cfGateway` to be configured.
	 */
	runFallback?(entries: FallbackEntry[], input: AiInput, options?: RunOptions): Promise<AiOutput>;
	/**
	 * Stream tokens and events from a model.
	 *
	 * Returns a `ReadableStream` of `GatewayStreamEvent`s. Every stream ends
	 * with exactly one `done` event. Optional — present on gateways returned
	 * by `createGateway` and on wrappers around them.
	 *
	 * Note on `options.responseFormat`: when set on a streaming call, providers
	 * add a system prompt asking for JSON only, but the output is still a
	 * token-by-token `text` stream. Consumers must buffer and parse the
	 * concatenated deltas themselves; streamed JSON validation is not performed.
	 */
	stream?(
		model: string,
		input: AiInput,
		options?: RunOptions,
	): Promise<ReadableStream<GatewayStreamEvent>>;
	/**
	 * Generate embeddings for one or more strings.
	 *
	 * Returns a `vectors` array with one embedding per input, in order. Always
	 * present on gateways from `createGateway`. Whether a given call succeeds
	 * depends on the target provider:
	 *  - Workers AI and OpenAI — supported.
	 *  - Anthropic — throws `ValidationError` (no public embeddings endpoint).
	 *  - Custom — delegates to `CustomProviderConfig.embed?`; throws
	 *    `ValidationError` if the provider config doesn't supply one.
	 *
	 * Optional on the `Gateway` interface so third-party implementers aren't
	 * forced to add it; wrappers (`withRetry`, `withCache`, `withLogging`)
	 * conditionally expose it when the underlying gateway does.
	 */
	embed?(model: string, input: EmbedInput, options?: RunOptions): Promise<EmbedOutput>;
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
	/** Tool use options — pass tools for the model to call */
	toolOptions?: GatewayToolOptions;
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
