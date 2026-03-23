import { ValidationError } from "@workkit/errors";
import type { Duration } from "./types";

const UNIT_MS: Record<string, number> = {
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

/**
 * Parse a duration string into milliseconds.
 *
 * @example
 * ```ts
 * parseDuration('1m')   // 60000
 * parseDuration('1h')   // 3600000
 * parseDuration('30s')  // 30000
 * ```
 */
export function parseDuration(duration: Duration): number {
	const match = duration.match(/^(\d+)(s|m|h|d)$/);
	if (!match) {
		throw new ValidationError("duration", [
			{
				path: ["duration"],
				message: `Invalid duration format: "${duration}". Expected format: <number><unit> where unit is s, m, h, or d`,
			},
		]);
	}

	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2]!;

	if (value <= 0) {
		throw new ValidationError("duration", [
			{
				path: ["duration"],
				message: `Duration value must be positive, got ${value}`,
			},
		]);
	}

	return value * UNIT_MS[unit]!;
}
