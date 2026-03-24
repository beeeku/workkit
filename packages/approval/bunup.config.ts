import { defineConfig } from "bunup";
export default defineConfig({
	entry: ["src/index.ts", "src/channels/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	clean: true,
	external: [
		"@workkit/types",
		"@workkit/errors",
		"@workkit/crypto",
		"@workkit/do",
		"@workkit/d1",
		"@workkit/queue",
		"hono",
	],
});
