import { ValidationError } from "@workkit/errors";
import { isValidCron } from "./parser";

/** State for building a cron expression */
interface CronState {
	minute: string;
	hour: string;
	dayOfMonth: string;
	month: string;
	dayOfWeek: string;
}

/** Builder returned by `cron().every(n?)` */
export interface EveryBuilder {
	/** Every minute (or every N minutes if n was provided) */
	minute(): CronBuildable;
	/** Alias for minute() */
	minutes(): CronBuildable;
	/** Every hour (or every N hours if n was provided) */
	hour(): CronBuildable;
	/** Alias for hour() */
	hours(): CronBuildable;
	/** Every day */
	day(): DayBuilder;
	/** Every weekday (Monday-Friday) */
	weekday(): DayBuilder;
	/** Every month */
	month(): CronBuildable;
}

/** Builder returned by `cron().on()` */
export interface OnBuilder {
	monday(): DayBuilder;
	tuesday(): DayBuilder;
	wednesday(): DayBuilder;
	thursday(): DayBuilder;
	friday(): DayBuilder;
	saturday(): DayBuilder;
	sunday(): DayBuilder;
	/** Specific day of month (1-31) */
	day(n: number): DayBuilder;
}

/** Builder that supports `.at(hour, minute?)` */
export interface DayBuilder {
	at(hour: number, minute?: number): CronBuildable;
}

/** Final builder with build() and toString() */
export interface CronBuildable {
	build(): string;
	toString(): string;
}

/** Root builder with every() and on() */
export interface CronBuilder {
	every(n?: number): EveryBuilder;
	on(): OnBuilder;
}

function createState(): CronState {
	return {
		minute: "*",
		hour: "*",
		dayOfMonth: "*",
		month: "*",
		dayOfWeek: "*",
	};
}

function buildExpression(state: CronState): string {
	const expr = `${state.minute} ${state.hour} ${state.dayOfMonth} ${state.month} ${state.dayOfWeek}`;
	if (!isValidCron(expr)) {
		throw new ValidationError(`Invalid cron expression: ${expr}`, [
			{ path: ["expression"], message: `Built invalid expression: ${expr}` },
		]);
	}
	return expr;
}

function makeBuildable(state: CronState): CronBuildable {
	return {
		build(): string {
			return buildExpression(state);
		},
		toString(): string {
			return buildExpression(state);
		},
	};
}

function makeDayBuilder(state: CronState): DayBuilder {
	return {
		at(hour: number, minute = 0): CronBuildable {
			state.hour = String(hour);
			state.minute = String(minute);
			return makeBuildable(state);
		},
	};
}

function makeEveryBuilder(n: number | undefined): EveryBuilder {
	const state = createState();

	return {
		minute(): CronBuildable {
			if (n !== undefined && n > 1) {
				state.minute = `*/${n}`;
			}
			return makeBuildable(state);
		},
		minutes(): CronBuildable {
			return this.minute();
		},
		hour(): CronBuildable {
			state.minute = "0";
			if (n !== undefined && n > 1) {
				state.hour = `*/${n}`;
			}
			return makeBuildable(state);
		},
		hours(): CronBuildable {
			return this.hour();
		},
		day(): DayBuilder {
			return makeDayBuilder(state);
		},
		weekday(): DayBuilder {
			state.dayOfWeek = "1-5";
			return makeDayBuilder(state);
		},
		month(): CronBuildable {
			state.minute = "0";
			state.hour = "0";
			state.dayOfMonth = "1";
			return makeBuildable(state);
		},
	};
}

function makeOnBuilder(): OnBuilder {
	const state = createState();

	function weekday(dow: number): DayBuilder {
		state.dayOfWeek = String(dow);
		return makeDayBuilder(state);
	}

	return {
		monday(): DayBuilder {
			return weekday(1);
		},
		tuesday(): DayBuilder {
			return weekday(2);
		},
		wednesday(): DayBuilder {
			return weekday(3);
		},
		thursday(): DayBuilder {
			return weekday(4);
		},
		friday(): DayBuilder {
			return weekday(5);
		},
		saturday(): DayBuilder {
			return weekday(6);
		},
		sunday(): DayBuilder {
			return weekday(0);
		},
		day(n: number): DayBuilder {
			state.dayOfMonth = String(n);
			return makeDayBuilder(state);
		},
	};
}

/**
 * Create a fluent cron expression builder.
 *
 * @example
 * ```ts
 * cron().every(5).minutes().build()     // "* /5 * * * *"
 * cron().every().day().at(9).build()    // "0 9 * * *"
 * cron().on().monday().at(14, 30).build() // "30 14 * * 1"
 * ```
 */
export function cron(): CronBuilder {
	return {
		every(n?: number): EveryBuilder {
			return makeEveryBuilder(n);
		},
		on(): OnBuilder {
			return makeOnBuilder();
		},
	};
}
