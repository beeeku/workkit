import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/validators/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: "linked",
	external: ["@workkit/types", "@workkit/errors", "@standard-schema/spec"],
	clean: true,
});
