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

		signal.addEventListener("abort", onAbort, { once: true });

		timer = setTimeout(() => {
			settleReject(new TimeoutError(`Tool execution exceeded ${timeoutMs}ms`));
		}, timeoutMs);

		// Use Promise.resolve().then(handler) so synchronous throws from handler
		// are converted to rejected promises and cleanup always runs.
		Promise.resolve()
			.then(handler)
			.then(settleResolve, settleReject);
	});
}
