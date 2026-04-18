import { defineWorkkitVitest } from "@workkit/vitest-config";

export default defineWorkkitVitest({
	include: ["__tests__/**/*.test.ts"],
	root: import.meta.dirname,
	testTimeout: 30_000,
});
