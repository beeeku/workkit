import { TimeoutError } from "@workkit/errors";

export async function executeWithTimeout<T>(
	handler: () => Promise<T>,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) {
		throw signal.reason ?? new Error("Aborted");
	}

	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout>;

		const cleanup = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
		};

		const settleResolve = (value: T) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};

		const settleReject = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};

		const onAbort = () => {
			settleReject(signal.reason ?? new Error("Aborted"));
		};

		// Assign timer before adding the abort listener so cleanup() is always
		// safe to call (clearTimeout on an unassigned variable is a no-op in JS
		// but explicit initialization avoids any linter/reader confusion).
		timer = setTimeout(() => {
			settleReject(new TimeoutError(`Tool execution exceeded ${timeoutMs}ms`));
		}, timeoutMs);

		signal.addEventListener("abort", onAbort, { once: true });

		// Use Promise.resolve().then(handler) so synchronous throws from handler
		// are converted to rejected promises and cleanup always runs.
		Promise.resolve()
			.then(handler)
			.then(settleResolve, settleReject);
	});
}
