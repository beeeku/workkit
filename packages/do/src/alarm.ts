import { ValidationError } from "@workkit/errors";
import type { TypedDurableObjectStorage } from "@workkit/types";
import type { AlarmHandler, AlarmHandlerConfig, AlarmSchedule } from "./types";

const DURATION_RE = /^(\d+)(s|m|h|d)$/;

const UNIT_MS: Record<string, number> = {
	s: 1_000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

/**
 * Parses a human-readable duration string into milliseconds.
 *
 * Supported formats: '30s', '5m', '1h', '2d'
 *
 * @throws {Error} If the format is invalid, zero, or negative
 */
export function parseDuration(duration: string): number {
	const match = duration.match(DURATION_RE);
	if (!match) {
		throw new ValidationError(
			`Invalid duration format: "${duration}". Expected format: <number><unit> where unit is s, m, h, or d.`,
			[
				{
					path: ["duration"],
					message: `Invalid format: "${duration}". Expected: <number><unit> (s, m, h, d)`,
				},
			],
		);
	}

	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2]!;

	if (value <= 0) {
		throw new ValidationError(`Duration must be positive, got: "${duration}"`, [
			{ path: ["duration"], message: `Must be positive, got: "${duration}"` },
		]);
	}

	return value * UNIT_MS[unit]!;
}

/**
 * Schedules an alarm on the Durable Object storage.
 *
 * ```ts
 * await scheduleAlarm(state.storage, { in: '5m' })     // 5 minutes from now
 * await scheduleAlarm(state.storage, { at: new Date() }) // specific time
 * ```
 */
export async function scheduleAlarm(
	storage: TypedDurableObjectStorage,
	schedule: AlarmSchedule,
): Promise<void> {
	let scheduledTime: number;

	if (schedule.in !== undefined) {
		const ms = parseDuration(schedule.in);
		scheduledTime = Date.now() + ms;
	} else {
		scheduledTime = schedule.at instanceof Date ? schedule.at.getTime() : schedule.at;
	}

	await storage.setAlarm(scheduledTime);
}

/**
 * Creates a type-safe alarm handler that routes to named action handlers.
 *
 * The current action name is read from storage (default key: '__alarm_action').
 * After the action completes, the key is cleared.
 *
 * ```ts
 * const handler = createAlarmHandler({
 *   actions: {
 *     'check-expiry': async (storage) => { ... },
 *     'send-reminder': async (storage) => { ... },
 *   },
 * })
 *
 * // In your DO's alarm() method:
 * async alarm() {
 *   await handler.handle(this.state.storage)
 * }
 * ```
 */
export function createAlarmHandler(config: AlarmHandlerConfig): AlarmHandler {
	const actionKey = config.actionKey ?? "__alarm_action";

	return {
		async handle(storage: TypedDurableObjectStorage): Promise<void> {
			const action = await storage.get<string>(actionKey);

			if (!action) {
				throw new ValidationError(
					`No alarm action found in storage at key "${actionKey}". Set the action before scheduling the alarm.`,
					[{ path: ["actionKey"], message: `No action found at key "${actionKey}"` }],
				);
			}

			const handler = config.actions[action];
			if (!handler) {
				const validActions = Object.keys(config.actions);
				throw new ValidationError(
					`Unknown alarm action: "${action}". ` + `Valid actions: [${validActions.join(", ")}]`,
					[
						{
							path: ["action"],
							message: `Unknown action "${action}". Valid actions: [${validActions.join(", ")}]`,
						},
					],
				);
			}

			await handler(storage);
			await storage.delete(actionKey);
		},
	};
}
