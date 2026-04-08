import type { CompensationHandler, Logger } from "./types";

const noopLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

interface CompensationInput {
	input: unknown;
	failedStep: string;
	error: Error;
	completedSteps: string[];
	stepOutputs: Record<string, unknown>;
	logger?: Logger;
}

export async function runCompensation(
	handler: CompensationHandler<any, any> | undefined,
	context: CompensationInput,
): Promise<void> {
	if (!handler) return;

	const log = context.logger ?? noopLogger;

	try {
		await handler({
			input: context.input,
			failedStep: context.failedStep,
			error: context.error,
			completedSteps: context.completedSteps,
			stepOutputs: context.stepOutputs,
			log,
		});
	} catch (error: any) {
		// Compensation errors are best-effort — log but don't propagate
		log.error("Compensation handler failed:", error.message);
	}
}
