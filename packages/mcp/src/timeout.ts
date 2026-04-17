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

		const timer = setTimeout(() => {
			settleReject(new TimeoutError(`Tool execution exceeded ${timeoutMs}ms`));
		}, timeoutMs);

		signal.addEventListener("abort", onAbort, { once: true });

		Promise.resolve().then(handler).then(settleResolve, settleReject);
	});
}
