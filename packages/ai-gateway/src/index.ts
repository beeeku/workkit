// Gateway
export { createGateway } from "./gateway";

// Router
export { createRouter } from "./router";

// Cost tracking
export { createCostTracker } from "./cost";

// Cache
export { withCache } from "./cache";

// Logging
export { withLogging } from "./logging";

// Retry
export { withRetry } from "./retry";
export type { RetryConfig } from "./retry";

// Fallback wrapper — two-tier provider failover usable as a model ref.
export { fallback, isFallbackModelRef, modelLabel } from "./fallback-wrapper";
export type { FallbackModelRef, FallbackMatcher, FallbackOptions } from "./fallback-wrapper";
export { FallbackExhaustedError } from "./errors";

// Tool registry — name/handler map for dispatching tool calls.
export { createToolRegistry } from "./tool-registry";
export type { ToolHandler, ToolRegistry } from "./tool-registry";

// Tool-use session — multi-turn execution with automatic dispatch.
export { aiWithTools } from "./tool-use";
export type { AiWithToolsOptions, AiWithToolsResult, ToolMessage } from "./tool-use";

// Structured output — JSON mode with Standard Schema validation + retry.
export { structuredAI, StructuredOutputError } from "./structured";
export type { StructuredOptions, StructuredResult } from "./structured";

// Schema conversion.
export { standardSchemaToJsonSchema } from "./schema";

// Token estimation — rough heuristic, not a tokenizer.
export { estimateTokens } from "./tokens";

// Types
export type {
	// Provider types
	ProviderType,
	ProviderConfig,
	WorkersAiProviderConfig,
	OpenAiProviderConfig,
	AnthropicProviderConfig,
	CustomProviderConfig,
	WorkersAiBinding,
	ProviderMap,
	// Gateway types
	Gateway,
	GatewayConfig,
	CfGatewayConfig,
	FallbackEntry,
	GatewayStreamEvent,
	EmbedInput,
	EmbedOutput,
	AiInput,
	AiOutput,
	ChatMessage,
	TokenUsage,
	RunOptions,
	// Tool use types
	GatewayToolDefinition,
	GatewayToolCall,
	GatewayToolOptions,
	// Router types
	Route,
	Router,
	RouterConfig,
	// Cost types
	CostTracker,
	CostTrackerConfig,
	CostSummary,
	ModelCostSummary,
	ModelPricing,
	UsageRecord,
	BudgetCheck,
	// Cache types
	CachedGateway,
	CacheConfig,
	CacheStorage,
	// Logging types
	LoggedGateway,
	LoggingConfig,
} from "./types";
