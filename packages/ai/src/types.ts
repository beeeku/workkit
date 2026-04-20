/**
 * Workers-AI model + IO type definitions from `@workkit/ai`.
 *
 * @deprecated Equivalent shapes live in `@workkit/ai-gateway` as
 * `AiInput` / `AiOutput` / `ChatMessage` / `TokenUsage` / `RunOptions`.
 * Per [ADR-001](../../.maina/decisions/001-ai-package-consolidation.md),
 * `@workkit/ai` will be removed at v2.0; track migration via
 * [#63](https://github.com/beeeku/workkit/issues/63).
 */

/** Supported text generation models */
export type TextGenerationModel =
	| "@cf/meta/llama-3.1-8b-instruct"
	| "@cf/meta/llama-3.1-70b-instruct"
	| "@cf/meta/llama-3-8b-instruct"
	| "@cf/mistral/mistral-7b-instruct-v0.2"
	| "@cf/qwen/qwen1.5-14b-chat-awq"
	| "@cf/google/gemma-7b-it"
	| "@hf/thebloke/deepseek-coder-6.7b-instruct-awq"
	| (string & {});

/** Supported text embedding models */
export type TextEmbeddingModel =
	| "@cf/baai/bge-base-en-v1.5"
	| "@cf/baai/bge-large-en-v1.5"
	| "@cf/baai/bge-small-en-v1.5"
	| (string & {});

/** Supported image classification models */
export type ImageClassificationModel = "@cf/microsoft/resnet-50" | (string & {});

/** Supported speech-to-text models */
export type SpeechToTextModel = "@cf/openai/whisper" | (string & {});

/** Supported text-to-image models */
export type TextToImageModel =
	| "@cf/stabilityai/stable-diffusion-xl-base-1.0"
	| "@cf/bytedance/stable-diffusion-xl-lightning"
	| (string & {});

/** Supported translation models */
export type TranslationModel = "@cf/meta/m2m100-1.2b" | (string & {});

/** Supported summarization models */
export type SummarizationModel = "@cf/facebook/bart-large-cnn" | (string & {});

/** Union of all model types */
export type AiModel =
	| TextGenerationModel
	| TextEmbeddingModel
	| ImageClassificationModel
	| SpeechToTextModel
	| TextToImageModel
	| TranslationModel
	| SummarizationModel;

/** Chat message roles */
export type MessageRole = "system" | "user" | "assistant";

/** A chat message */
export interface AiMessage {
	role: MessageRole;
	content: string;
}

/** Input for text generation models */
export interface TextGenerationInput {
	messages?: AiMessage[];
	prompt?: string;
	stream?: boolean;
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	top_k?: number;
	repetition_penalty?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
}

/** Input for text embedding models */
export interface TextEmbeddingInput {
	text: string | string[];
}

/** Input for image classification models */
export interface ImageClassificationInput {
	image: ArrayBuffer | Uint8Array | number[];
}

/** Input for speech-to-text models */
export interface SpeechToTextInput {
	audio: ArrayBuffer | Uint8Array | number[];
}

/** Input for text-to-image models */
export interface TextToImageInput {
	prompt: string;
	num_steps?: number;
	guidance?: number;
	strength?: number;
	width?: number;
	height?: number;
}

/** Input for translation models */
export interface TranslationInput {
	text: string;
	source_lang: string;
	target_lang: string;
}

/** Input for summarization models */
export interface SummarizationInput {
	input_text: string;
	max_length?: number;
}

/** Output from text generation models */
export interface TextGenerationOutput {
	response: string;
}

/** Output from text embedding models */
export interface TextEmbeddingOutput {
	shape: number[];
	data: number[][];
}

/** Image classification label */
export interface ClassificationLabel {
	label: string;
	score: number;
}

/** Output from image classification models */
export type ImageClassificationOutput = ClassificationLabel[];

/** Output from speech-to-text models */
export interface SpeechToTextOutput {
	text: string;
	vtt?: string;
	words?: Array<{ word: string; start: number; end: number }>;
}

/** Output from text-to-image models */
export type TextToImageOutput = ReadableStream<Uint8Array>;

/** Output from translation models */
export interface TranslationOutput {
	translated_text: string;
}

/** Output from summarization models */
export interface SummarizationOutput {
	summary: string;
}

/** Map model category to its input type */
export interface ModelInputMap {
	textGeneration: TextGenerationInput;
	textEmbedding: TextEmbeddingInput;
	imageClassification: ImageClassificationInput;
	speechToText: SpeechToTextInput;
	textToImage: TextToImageInput;
	translation: TranslationInput;
	summarization: SummarizationInput;
}

/** Map model category to its output type */
export interface ModelOutputMap {
	textGeneration: TextGenerationOutput;
	textEmbedding: TextEmbeddingOutput;
	imageClassification: ImageClassificationOutput;
	speechToText: SpeechToTextOutput;
	textToImage: TextToImageOutput;
	translation: TranslationOutput;
	summarization: SummarizationOutput;
}

/** Infer the input type for a given model string */
export type InferInput<M extends string> = M extends TextGenerationModel
	? TextGenerationInput
	: M extends TextEmbeddingModel
		? TextEmbeddingInput
		: M extends ImageClassificationModel
			? ImageClassificationInput
			: M extends SpeechToTextModel
				? SpeechToTextInput
				: M extends TextToImageModel
					? TextToImageInput
					: M extends TranslationModel
						? TranslationInput
						: M extends SummarizationModel
							? SummarizationInput
							: Record<string, unknown>;

/** Infer the output type for a given model string */
export type InferOutput<M extends string> = M extends TextGenerationModel
	? TextGenerationOutput
	: M extends TextEmbeddingModel
		? TextEmbeddingOutput
		: M extends ImageClassificationModel
			? ImageClassificationOutput
			: M extends SpeechToTextModel
				? SpeechToTextOutput
				: M extends TextToImageModel
					? TextToImageOutput
					: M extends TranslationModel
						? TranslationOutput
						: M extends SummarizationModel
							? SummarizationOutput
							: unknown;

/** Options for the AI client run call */
export interface RunOptions {
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	/** Gateway configuration */
	gateway?: AiGatewayConfig;
}

/** Cloudflare AI Gateway config */
export interface AiGatewayConfig {
	id: string;
	skipCache?: boolean;
	cacheTtl?: number;
}

/** Fallback chain entry */
export interface FallbackEntry<M extends string = string> {
	model: M;
	/** Timeout in milliseconds for this model */
	timeout?: number;
}

/** Retry backoff strategy */
export type BackoffStrategy = "fixed" | "linear" | "exponential";

/** Retry options */
export interface RetryOptions {
	/** Maximum number of retries (default: 3) */
	maxRetries?: number;
	/** Backoff strategy (default: 'exponential') */
	backoff?: BackoffStrategy;
	/** Base delay in milliseconds (default: 1000) */
	baseDelay?: number;
	/** Maximum delay in milliseconds (default: 30000) */
	maxDelay?: number;
	/** AbortSignal for cancellation */
	signal?: AbortSignal;
	/** Whether to retry on timeout errors (default: true) */
	retryOnTimeout?: boolean;
	/** Custom function to determine if an error is retryable */
	isRetryable?: (error: unknown) => boolean;
}

/**
 * Minimal AI binding interface matching Cloudflare's Ai type.
 * This allows usage without requiring @cloudflare/workers-types at runtime.
 */
export interface AiBinding {
	run(
		model: string,
		inputs: Record<string, unknown>,
		options?: Record<string, unknown>,
	): Promise<unknown>;
}

/** Result from the AI client, wrapping the output with metadata */
export interface AiResult<T> {
	/** The model output */
	data: T;
	/** The model that produced the output */
	model: string;
}

/** Fallback result includes which model was used and which were attempted */
export interface FallbackResult<T> extends AiResult<T> {
	/** Models that were attempted before success */
	attempted: string[];
	/** Number of attempts made */
	attempts: number;
}

/** Retry result includes retry count */
export interface RetryResult<T> extends AiResult<T> {
	/** Number of retry attempts made (0 = first try succeeded) */
	retries: number;
}
