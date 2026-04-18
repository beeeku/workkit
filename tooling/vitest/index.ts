import { type LogErrorOptions, type LogOptions, createLogger } from "vite";
import { type UserConfig, defineConfig } from "vitest/config";

/**
 * Shared vitest config factory for the workkit monorepo.
 *
 * - Mutes the upstream `[vite] warning: \`esbuild\` option was specified by
 *   "vitest" plugin` deprecation that fires once per run on vitest 3 + vite 8.
 *   Vitest's internal plugin sets the deprecated option; we can't change that
 *   from user config. Tracked at vitest-dev/vitest#9800; remove the filter
 *   once vitest 4 stable lands.
 * - Otherwise transparent: callers pass the same `test` block they would
 *   pass to `defineConfig({ test: ... })`.
 */
export function defineWorkkitVitest(test: NonNullable<UserConfig["test"]> = {}): UserConfig {
	const logger = createLogger();
	const baseWarn = logger.warn;
	logger.warn = (msg: string, opts?: LogOptions | LogErrorOptions): void => {
		if (typeof msg === "string" && msg.includes("`esbuild` option was specified")) return;
		baseWarn(msg, opts);
	};
	return defineConfig({
		customLogger: logger,
		test,
	});
}
