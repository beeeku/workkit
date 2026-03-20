/** A retry action with a delay */
export interface RetryDelayAction {
	action: "retry";
	delaySeconds: number;
}

/**
 * Retry action constants for controlling message retry behavior.
 *
 * Return these from your consumer's process() function to control
 * what happens to the message after processing.
 */
export const RetryAction = {
	/** Retry the message immediately */
	RETRY: "retry" as const,

	/** Acknowledge (discard) the message */
	ACK: "ack" as const,

	/** Send to dead letter queue (or ack if no DLQ configured) */
	DEAD_LETTER: "dead_letter" as const,

	/** Retry the message after a delay */
	RETRY_DELAY(seconds: number): RetryDelayAction {
		return { action: "retry", delaySeconds: seconds };
	},
};

/** Check if a process result is a retry delay action */
export function isRetryDelayAction(result: unknown): result is RetryDelayAction {
	return (
		typeof result === "object" &&
		result !== null &&
		"action" in result &&
		(result as any).action === "retry" &&
		"delaySeconds" in result
	);
}
