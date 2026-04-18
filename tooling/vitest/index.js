import { createLogger } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Shared vitest config factory for the workkit monorepo.
 *
 * Filters the upstream `[vite] warning: \`esbuild\` option was specified by
 * "vitest" plugin` deprecation that fires once per run on vitest 3 + vite 8.
 * Vitest's internal plugin sets the deprecated option; we can't change that
 * from user config. Tracked at vitest-dev/vitest#9800; remove the filter
 * once vitest 4 stable lands.
 *
 * @param {import("vitest/config").UserConfig["test"]} [test] vitest test block
 * @returns {import("vitest/config").UserConfig}
 */
export function defineWorkkitVitest(test = {}) {
	const logger = createLogger();
	const baseWarn = logger.warn;
	logger.warn = (msg, opts) => {
		if (typeof msg === "string" && msg.includes("`esbuild` option was specified")) return;
		baseWarn(msg, opts);
	};
	return defineConfig({
		customLogger: logger,
		test,
	});
}
