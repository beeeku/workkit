import {
	RateLimitError,
	ServiceUnavailableError,
	TimeoutError,
	ValidationError,
} from "@workkit/errors";

export class FontLoadError extends ValidationError {
	constructor(family: string, cause?: unknown) {
		super(
			`font "${family}" failed to load (document.fonts.check returned false after load)`,
			[{ path: ["loadFonts", family], message: "font not available after load" }],
			{ cause: cause instanceof Error ? cause : undefined, context: { family } },
		);
	}
}

export interface BrowserBindingError {
	readonly message?: string;
	readonly status?: number;
	readonly headers?: Headers | Record<string, string>;
	readonly name?: string;
}

function readHeader(
	headers: Headers | Record<string, string> | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	if (headers instanceof Headers) return headers.get(name) ?? undefined;
	const direct = headers[name] ?? headers[name.toLowerCase()];
	return typeof direct === "string" ? direct : undefined;
}

function parseRetryAfterMs(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
	const date = Date.parse(value);
	if (Number.isFinite(date)) return Math.max(0, date - Date.now());
	return undefined;
}

export function normalizeBrowserError(operation: string, err: unknown): Error {
	if (
		err instanceof Error &&
		(err.name === "AbortError" || (err as { name?: string }).name === "AbortError")
	) {
		return err;
	}

	const candidate = err as BrowserBindingError | undefined;
	const message = candidate?.message ?? (typeof err === "string" ? err : "browser binding error");
	const status = candidate?.status;
	const cause = err instanceof Error ? err : undefined;

	if (status === 429) {
		const retryAfterMs = parseRetryAfterMs(readHeader(candidate?.headers, "Retry-After"));
		return new RateLimitError(message, retryAfterMs, { cause, context: { operation } });
	}

	if (status === 503 || status === 502 || status === 504) {
		return new ServiceUnavailableError("browser-rendering", {
			cause,
			context: { operation, status },
		});
	}

	if (/timeout|timed out/i.test(message)) {
		return new TimeoutError(operation, undefined, { cause });
	}

	return new ServiceUnavailableError("browser-rendering", {
		cause,
		context: { operation, message },
	});
}
