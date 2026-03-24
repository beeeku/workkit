import type { createJournal } from "./journal";
import type {
	ExecutionMeta,
	Logger,
	StepContext,
	StepDefinition,
	WorkflowConfig,
	WorkflowError,
} from "./types";

type Journal = ReturnType<typeof createJournal>;
interface StorageLike {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: any): Promise<void>;
}

const noopLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

export function createExecutor(
	steps: StepDefinition[],
	config: WorkflowConfig,
	_storage: StorageLike,
	journal: Journal,
) {
	const logger = config.logger ?? noopLogger;

	return {
		async execute(
			input: unknown,
			executionId: string,
		): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: WorkflowError }> {
			// Write metadata
			const meta: ExecutionMeta = {
				executionId,
				workflowName: "",
				workflowVersion: config.version ?? "0.0.0",
				status: "running",
				createdAt: Date.now(),
				startedAt: Date.now(),
				stepCount: steps.length,
				completedStepCount: 0,
			};
			await journal.writeMeta(meta);
			await journal.writeInput(input);
			await journal.setStepCount(steps.length);

			// Build prev map from completed journal entries
			const prev: Record<string, unknown> = {};
			let startIndex = 0;

			// Check for completed steps (replay)
			for (let i = 0; i < steps.length; i++) {
				const entry = await journal.readEntry(i);
				if (entry && entry.status === "completed" && entry.output !== undefined) {
					prev[steps[i]!.name] = entry.output;
					startIndex = i + 1;
					meta.completedStepCount++;
				} else {
					break;
				}
			}

			// Execute remaining steps
			for (let i = startIndex; i < steps.length; i++) {
				const step = steps[i]!;
				if (step.type !== "step" || !step.handler) continue;

				meta.currentStep = step.name;
				await journal.writeMeta(meta);

				const retryConfig = step.options?.retry ??
					config.retry ?? {
						maxAttempts: 1,
						initialDelay: 0,
						maxDelay: 0,
						backoffMultiplier: 1,
					};

				let lastError: Error | null = null;
				let succeeded = false;

				for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
					// Write running entry
					await journal.writeEntry(i, {
						index: i,
						name: step.name,
						status: "running",
						input: Object.keys(prev),
						attempt,
						startedAt: Date.now(),
					});

					try {
						const ctx: StepContext = {
							attempt,
							executionId,
							stepName: step.name,
							log: logger,
							signal: new AbortController().signal,
							idempotencyKey: `${executionId}:${step.name}:${attempt}`,
						};

						const startTime = Date.now();
						const prevSnapshot = Object.freeze({ ...prev });
						const output = await step.handler(input, prevSnapshot, ctx);
						const duration = Date.now() - startTime;

						// Write completed entry
						await journal.writeEntry(i, {
							index: i,
							name: step.name,
							status: "completed",
							input: Object.keys(prev),
							output,
							attempt,
							startedAt: startTime,
							completedAt: Date.now(),
							duration,
						});

						prev[step.name] = output;
						meta.completedStepCount++;
						succeeded = true;
						break;
					} catch (error: any) {
						lastError = error;

						await journal.writeEntry(i, {
							index: i,
							name: step.name,
							status: attempt >= retryConfig.maxAttempts ? "failed" : "running",
							input: Object.keys(prev),
							error: {
								name: error.name,
								message: error.message,
								retryable: attempt < retryConfig.maxAttempts,
							},
							attempt,
							startedAt: Date.now(),
						});

						if (attempt < retryConfig.maxAttempts) {
							const delay = Math.min(
								retryConfig.initialDelay * retryConfig.backoffMultiplier ** (attempt - 1),
								retryConfig.maxDelay,
							);
							if (delay > 0) await new Promise((r) => setTimeout(r, delay));
						}
					}
				}

				if (!succeeded) {
					meta.status = "failed";
					meta.completedAt = Date.now();
					meta.error = { name: lastError!.name, message: lastError!.message, retryable: false };
					await journal.writeMeta(meta);

					const journalEntries = await journal.readAll();
					return {
						ok: false,
						error: {
							executionId,
							failedStep: step.name,
							stepAttempt: retryConfig.maxAttempts,
							message: lastError!.message,
							journal: journalEntries,
						},
					};
				}
			}

			meta.status = "completed";
			meta.completedAt = Date.now();
			await journal.writeMeta(meta);

			return { ok: true, value: prev };
		},
	};
}
