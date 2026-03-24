// @workkit/workflow types

export interface Logger {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

// ─── Workflow Status ──────────────────────────────────────────
export type WorkflowStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "waiting"
	| "sleeping";

// ─── Step Journal ─────────────────────────────────────────────
export interface StepJournalEntry<TOutput = unknown> {
	index: number;
	name: string;
	status: "pending" | "running" | "completed" | "failed" | "skipped";
	input: unknown;
	output?: TOutput;
	error?: SerializedStepError;
	startedAt?: number;
	completedAt?: number;
	duration?: number;
	attempt: number;
}

export interface SerializedStepError {
	name: string;
	message: string;
	code?: string;
	retryable: boolean;
}

// ─── Execution Metadata ───────────────────────────────────────
export interface ExecutionMeta {
	executionId: string;
	workflowName: string;
	workflowVersion: string;
	status: WorkflowStatus;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	currentStep?: string;
	stepCount: number;
	completedStepCount: number;
	error?: SerializedStepError;
}

// ─── Execution Handle ─────────────────────────────────────────
export interface ExecutionHandle<TOutput = unknown> {
	readonly executionId: string;
	status(): Promise<WorkflowStatus>;
	result(): Promise<{ ok: true; value: TOutput } | { ok: false; error: WorkflowError }>;
	meta(): Promise<ExecutionMeta>;
	journal(): Promise<StepJournalEntry[]>;
	resume(event: string, payload?: unknown): Promise<void>;
	cancel(): Promise<void>;
}

// ─── Workflow Error ───────────────────────────────────────────
export interface WorkflowError {
	executionId: string;
	failedStep: string;
	stepAttempt: number;
	message: string;
	journal: StepJournalEntry[];
}

// ─── Backend Config ───────────────────────────────────────────
export type WorkflowBackend =
	| { type: "do"; namespace: DurableObjectNamespace; history?: D1Database }
	| { type: "cf-workflows"; binding: unknown };

export interface RetryStrategy {
	maxAttempts: number;
	initialDelay: number;
	maxDelay: number;
	backoffMultiplier: number;
}

// ─── Workflow Config ──────────────────────────────────────────
export interface WorkflowConfig {
	backend: WorkflowBackend;
	version?: string;
	retry?: RetryStrategy;
	timeout?: string;
	executionTtl?: string;
	idempotencyKey?: (input: unknown) => string;
	logger?: Logger;
}

// ─── Step Types ───────────────────────────────────────────────
export type StepHandler<TInput, TPrev, TOutput> = (
	input: TInput,
	prev: Readonly<TPrev>,
	ctx: StepContext,
) => Promise<TOutput>;

export interface StepContext {
	readonly attempt: number;
	readonly executionId: string;
	readonly stepName: string;
	readonly log: Logger;
	readonly signal: AbortSignal;
	readonly idempotencyKey: string;
}

export interface StepOptions {
	retry?: RetryStrategy;
	timeout?: string;
	idempotencyKey?: (input: unknown) => string;
}

// ─── Compensation ─────────────────────────────────────────────
export type CompensationHandler<TInput, TPrev> = (
	ctx: CompensationContext<TInput, TPrev>,
) => Promise<void>;

export interface CompensationContext<TInput, TPrev> {
	readonly input: TInput;
	readonly failedStep: string;
	readonly error: Error;
	readonly completedSteps: readonly string[];
	readonly stepOutputs: Partial<TPrev>;
	readonly log: Logger;
}

// ─── Step Definition (internal) ───────────────────────────────
export interface StepDefinition {
	name: string;
	type: "step" | "sleep" | "wait";
	handler?: StepHandler<any, any, any>;
	options?: StepOptions;
	duration?: string;
	eventName?: string;
}

// ─── Workflow Builder Interface ───────────────────────────────
export interface WorkflowBuilder<TInput, TPrev extends Record<string, unknown>> {
	step<TName extends string, TOutput>(
		name: TName,
		handler: StepHandler<TInput, TPrev, TOutput>,
		options?: StepOptions,
	): WorkflowBuilder<TInput, TPrev & Record<TName, TOutput>>;

	onFailure(handler: CompensationHandler<TInput, TPrev>): WorkflowDef<TInput, TPrev>;
	build(): WorkflowDef<TInput, TPrev>;
}

// ─── Workflow Definition ──────────────────────────────────────
export interface RunOptions {
	executionId?: string;
	idempotencyKey?: string;
	delay?: string;
}

export interface WorkflowDef<
	TInput,
	TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
	readonly name: string;
	readonly version: string;
	run(input: TInput, options?: RunOptions): Promise<ExecutionHandle<TOutput>>;
	cancel(executionId: string): Promise<void>;
	execution(executionId: string): ExecutionHandle<TOutput>;
}
