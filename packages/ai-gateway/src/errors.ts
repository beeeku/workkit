/**
 * Thrown by `gateway.run()` when a `FallbackModelRef` is used and BOTH the
 * primary and secondary attempts fail. The original tier errors are preserved
 * on `.primaryError` and `.secondaryError` for programmatic inspection; the
 * primary is also set as the `.cause` so structured loggers surface it.
 */
export class FallbackExhaustedError extends Error {
	readonly name = "FallbackExhaustedError";
	readonly primaryError: unknown;
	readonly secondaryError: unknown;

	constructor(primaryError: unknown, secondaryError: unknown) {
		super(
			`Fallback exhausted: both primary and secondary attempts failed (primary: ${describe(primaryError)}; secondary: ${describe(secondaryError)})`,
			{ cause: primaryError },
		);
		this.primaryError = primaryError;
		this.secondaryError = secondaryError;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

function describe(err: unknown): string {
	if (err instanceof Error) return `${err.name}: ${err.message}`;
	return String(err);
}
