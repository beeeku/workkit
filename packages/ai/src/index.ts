// Client
export { ai } from "./client";
export type { WorkkitAiClient } from "./client";

// Streaming
export { streamAI } from "./stream";
export type { StreamOptions } from "./stream";

// Fallback
export { fallback } from "./fallback";
export type { FallbackOptions } from "./fallback";

// Retry
export { withRetry, calculateDelay, defaultIsRetryable } from "./retry";

// Structured output / JSON mode
export { structuredAI } from "./structured";
export type { StructuredOptions, StructuredResult } from "./structured";

// Schema conversion
export { standardSchemaToJsonSchema } from "./schema";

// Errors
export { StructuredOutputError } from "./errors";

// Token estimation
export { estimateTokens } from "./tokens";

// Tool use
export { aiWithTools } from "./tool-use";
export type { ToolMessage } from "./tool-use";
export { createToolRegistry } from "./tool-registry";
export type { ToolHandler, ToolRegistry } from "./tool-registry";
export type {
	ToolDefinition,
	ToolCall,
	ToolResult,
	ToolUseOptions,
	ToolUseResult,
} from "./tools";

// Types
export type {
	AiModel,
	TextGenerationModel,
	TextEmbeddingModel,
	ImageClassificationModel,
	SpeechToTextModel,
	TextToImageModel,
	TranslationModel,
	SummarizationModel,
	MessageRole,
	AiMessage,
	TextGenerationInput,
	TextEmbeddingInput,
	ImageClassificationInput,
	SpeechToTextInput,
	TextToImageInput,
	TranslationInput,
	SummarizationInput,
	TextGenerationOutput,
	TextEmbeddingOutput,
	ImageClassificationOutput,
	ClassificationLabel,
	SpeechToTextOutput,
	TextToImageOutput,
	TranslationOutput,
	SummarizationOutput,
	InferInput,
	InferOutput,
	RunOptions,
	AiGatewayConfig,
	FallbackEntry,
	BackoffStrategy,
	RetryOptions,
	AiBinding,
	AiResult,
	FallbackResult,
	RetryResult,
} from "./types";
