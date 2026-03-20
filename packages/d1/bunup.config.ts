import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/migrate.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	external: ["@workkit/types", "@workkit/errors", "@cloudflare/workers-types"],
	clean: true,
	target: "browser",
});
