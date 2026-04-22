import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/client/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	clean: true,
	external: ["@workkit/types", "@workkit/do"],
});
