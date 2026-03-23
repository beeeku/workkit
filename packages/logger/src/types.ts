/** Log levels in order of severity */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Arbitrary fields that can be attached to log entries */
export type LogFields = Record<string, unknown>;

/** A single structured log entry */
export interface LogEntry {
	/** Log level */
	level: LogLevel;
	/** Human-readable message */
	msg: string;
	/** Unix timestamp in milliseconds */
	ts: number;
	/** Additional fields merged from base, context, child, and call-site */
	[key: string]: unknown;
}

/** Options for creating a standalone logger */
export interface CreateLoggerOptions {
	/** Minimum log level to emit (default: "info") */
	level?: LogLevel;
	/** Base fields attached to every log entry */
	fields?: LogFields;
}

/** Options for the Hono logger middleware */
export interface LoggerMiddlewareOptions {
	/** Minimum log level to emit (default: "info") */
	level?: LogLevel;
	/** Routes to exclude from automatic request logging (exact match or startsWith) */
	exclude?: string[];
	/** Header name to use as requestId (default: auto-generate) */
	requestId?: string;
	/** Base fields attached to every log entry */
	fields?: LogFields;
	/** Whether to auto-log request timing (default: true) */
	timing?: boolean;
	/** Field names or custom function for redacting sensitive data */
	redact?: string[] | ((key: string, value: unknown) => unknown);
}

/** Logger instance with level methods and child support */
export interface Logger {
	/** Log at debug level */
	debug(msg: string, fields?: LogFields): void;
	/** Log at info level */
	info(msg: string, fields?: LogFields): void;
	/** Log at warn level */
	warn(msg: string, fields?: LogFields): void;
	/** Log at error level */
	error(msg: string, fields?: LogFields): void;
	/** Create a child logger with additional persistent fields */
	child(fields: LogFields): Logger;
	/** Current minimum log level */
	readonly level: LogLevel;
}

/** Request context stored in AsyncLocalStorage */
export interface RequestContext {
	/** Unique request identifier */
	requestId: string;
	/** HTTP method */
	method: string;
	/** Request path */
	path: string;
	/** Request start time (ms) */
	startTime: number;
	/** Additional context fields */
	fields: LogFields;
}
