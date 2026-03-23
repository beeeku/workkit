import { shouldLog } from "./levels";
import { serialize } from "./serializer";
import type {
	CreateLoggerOptions,
	LogFields,
	LogLevel,
	Logger,
	LoggerMiddlewareOptions,
} from "./types";

const CONSOLE_METHODS: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
	debug: "debug",
	info: "info",
	warn: "warn",
	error: "error",
};

/**
 * Create a standalone structured logger.
 *
 * Use this in queue consumers, cron handlers, Durable Objects, or anywhere
 * outside of a Hono request context. For Hono apps, use the `logger()` middleware instead.
 *
 * @example
 * ```ts
 * const log = createLogger({ service: 'email-worker', level: 'debug' })
 * log.info('processing batch', { count: 50 })
 *
 * const childLog = log.child({ batchId: 'abc' })
 * childLog.info('item processed')
 * ```
 */
export function createLogger(options?: CreateLoggerOptions): Logger {
	const minLevel = options?.level ?? "info";
	const baseFields = options?.fields ?? {};

	return buildLogger(minLevel, baseFields);
}

function buildLogger(minLevel: LogLevel, fields: LogFields): Logger {
	function emit(level: LogLevel, msg: string, callFields?: LogFields): void {
		if (!shouldLog(level, minLevel)) return;
		const merged = callFields ? { ...fields, ...callFields } : { ...fields };
		const json = serialize(level, msg, merged);
		console[CONSOLE_METHODS[level]](json);
	}

	return {
		get level() {
			return minLevel;
		},
		debug(msg, callFields) {
			emit("debug", msg, callFields);
		},
		info(msg, callFields) {
			emit("info", msg, callFields);
		},
		warn(msg, callFields) {
			emit("warn", msg, callFields);
		},
		error(msg, callFields) {
			emit("error", msg, callFields);
		},
		child(childFields) {
			return buildLogger(minLevel, { ...fields, ...childFields });
		},
	};
}

/**
 * Build a logger that includes context fields and supports redaction.
 * Used internally by the middleware.
 */
export function buildContextLogger(
	minLevel: LogLevel,
	contextFields: LogFields,
	redact?: LoggerMiddlewareOptions["redact"],
): Logger {
	function emit(level: LogLevel, msg: string, callFields?: LogFields): void {
		if (!shouldLog(level, minLevel)) return;
		const merged = { ...contextFields, ...(callFields ?? {}) };
		const json = serialize(level, msg, merged, redact);
		console[CONSOLE_METHODS[level]](json);
	}

	return {
		get level() {
			return minLevel;
		},
		debug(msg, callFields) {
			emit("debug", msg, callFields);
		},
		info(msg, callFields) {
			emit("info", msg, callFields);
		},
		warn(msg, callFields) {
			emit("warn", msg, callFields);
		},
		error(msg, callFields) {
			emit("error", msg, callFields);
		},
		child(childFields) {
			return buildContextLogger(minLevel, { ...contextFields, ...childFields }, redact);
		},
	};
}
