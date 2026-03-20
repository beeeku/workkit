import { defineConfig } from "bunup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/kv.ts",
		"src/d1.ts",
		"src/r2.ts",
		"src/queue.ts",
		"src/do.ts",
		"src/env.ts",
		"src/request.ts",
		"src/context.ts",
	],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	clean: true,
});
