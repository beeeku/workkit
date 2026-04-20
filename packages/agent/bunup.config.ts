import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	clean: true,
	target: "browser",
	external: ["@workkit/ai-gateway", "@workkit/errors", "@standard-schema/spec"],
});
