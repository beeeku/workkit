import type { LogLevel } from "./types";

/** Numeric values for log levels, used for filtering */
export const LEVEL_VALUES: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

/**
 * Determine if a message at `msgLevel` should be logged given the configured `minLevel`.
 *
 * @example
 * ```ts
 * shouldLog("debug", "info") // false — debug is below info
 * shouldLog("warn", "info")  // true  — warn is above info
 * ```
 */
export function shouldLog(msgLevel: LogLevel, minLevel: LogLevel): boolean {
	return LEVEL_VALUES[msgLevel] >= LEVEL_VALUES[minLevel];
}
