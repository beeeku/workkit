import type { UserConfig } from "vitest/config";

/**
 * Shared vitest config factory for the workkit monorepo. Filters the
 * upstream `esbuild` deprecation warning that vitest 3 fires on vite 8.
 */
export function defineWorkkitVitest(test?: NonNullable<UserConfig["test"]>): UserConfig;
