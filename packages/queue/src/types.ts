import type {
	QueueSendBatchOptions,
	QueueSendOptions,
	TypedMessageBatch,
	TypedMessageSendRequest,
	TypedQueue,
} from "@workkit/types";
import type { RetryDelayAction } from "./retry";

// --- Producer types ---

/** A typed queue producer wrapping a Cloudflare Queue binding */
export interface TypedQueueProducer<Body> {
	/** Send a single typed message */
	send(body: Body, options?: QueueSendOptions): Promise<void>;
	/** Send a batch of typed messages */
	sendBatch(
		messages: Iterable<TypedMessageSendRequest<Body>>,
		options?: QueueSendBatchOptions,
	): Promise<void>;
	/** The underlying raw queue binding */
	readonly raw: TypedQueue<Body>;
}

// --- Consumer types ---

/** A message as seen by a consumer — extends TypedMessage with ack/retry */
export interface ConsumerMessage<Body> {
	readonly id: string;
	readonly timestamp: Date;
	readonly body: Body;
	readonly attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** Return type from process() — void for success, or a retry action */
export type ProcessResult = undefined | string | RetryDelayAction;

/** Options for createConsumer() */
export interface ConsumerOptions<Body> {
	/** Process a single message. Return a RetryAction to control retry behavior. */
	process: (message: ConsumerMessage<Body>) => Promise<ProcessResult> | ProcessResult;
	/** Filter function — only matching messages are processed */
	filter?: (message: ConsumerMessage<Body>) => boolean;
	/** What to do with filtered-out messages: 'ack' (default) or 'retry' */
	onFiltered?: "ack" | "retry";
	/** Maximum retry attempts before discarding or sending to DLQ */
	maxRetries?: number;
	/** Dead letter queue binding — failed messages go here after maxRetries */
	deadLetterQueue?: TypedQueue<Body>;
	/** Error callback — called when processing throws */
	onError?: (error: unknown, message: ConsumerMessage<Body>) => void;
	/** Concurrency limit for parallel processing. Default: 1 (sequential) */
	concurrency?: number;
}

/** Options for createBatchConsumer() */
export interface BatchConsumerOptions<Body> {
	/** Process the entire batch of messages at once */
	processBatch: (messages: readonly ConsumerMessage<Body>[]) => Promise<void> | void;
	/** Whether to retry all messages on batch failure. Default: true */
	retryAll?: boolean;
	/** Error callback — called when batch processing throws */
	onError?: (error: unknown) => void;
}

/** A consumer handler function — pass to your worker's queue() handler */
export type ConsumerHandler<Body> = (batch: TypedMessageBatch<Body>, env: unknown) => Promise<void>;

// --- DLQ types ---

/** Metadata about a dead letter message */
export interface DLQMetadata {
	/** The queue name this message came from */
	queue: string;
	/** Number of delivery attempts */
	attempts: number;
	/** The message ID */
	messageId: string;
	/** Original message timestamp */
	timestamp: Date;
}

/** Options for createDLQProcessor() */
export interface DLQProcessorOptions<Body> {
	/** Process a dead letter message with its metadata */
	process: (message: ConsumerMessage<Body>, metadata: DLQMetadata) => Promise<void> | void;
	/** Error callback */
	onError?: (error: unknown, message: ConsumerMessage<Body>) => void;
}

// --- Circuit breaker types ---

/** Duration string for circuit breaker */
export type Duration = `${number}${"s" | "m" | "h" | "d"}`;

/** Options for circuit breaker */
export interface CircuitBreakerOptions {
	namespace: KVNamespace;
	key: string;
	failureThreshold: number;
	resetTimeout: Duration;
	halfOpenMax?: number;
}

/** Internal circuit breaker state */
export interface CircuitBreakerState {
	state: "closed" | "open" | "half-open";
	failures: number;
	lastFailure: number;
	openedAt: number;
	halfOpenAttempts: number;
}

// --- Workflow types ---

/** Options for createWorkflow() */
export interface WorkflowOptions<Body, Context = Record<string, unknown>> {
	steps: WorkflowStep<Body, Context>[];
	onComplete?: (body: Body, context: Context) => Promise<void>;
	onError?: (error: unknown, stepName: string, body: Body) => Promise<void>;
}

/** A single workflow step */
export interface WorkflowStep<Body, Context> {
	name: string;
	process: (body: Body, context: Context) => Promise<Partial<Context>>;
	rollback?: (body: Body, context: Context) => Promise<void>;
}

// --- DLQ Analyzer types ---

/** Options for createDLQAnalyzer() */
export interface DLQAnalyzerOptions<_Body = unknown> {
	namespace: KVNamespace;
	prefix?: string;
	windowSize?: Duration;
}

/** A DLQ analyzer for tracking failure patterns */
export interface DLQAnalyzer<Body> {
	record(message: ConsumerMessage<Body>, metadata: DLQMetadata, error?: unknown): Promise<void>;
	summary(): Promise<DLQSummary>;
	topErrors(limit?: number): Promise<ErrorPattern[]>;
}

/** Summary of DLQ failure patterns */
export interface DLQSummary {
	total: number;
	byQueue: Record<string, number>;
	byHour: Record<string, number>;
	topErrors: ErrorPattern[];
}

/** A grouped error pattern */
export interface ErrorPattern {
	message: string;
	count: number;
	lastSeen: Date;
	sampleMessageIds: string[];
}

// Re-export for convenience
export type { RetryDelayAction } from "./retry";
