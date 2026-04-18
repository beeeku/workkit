import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/adapters/email/index.ts", "src/adapters/inapp/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	clean: true,
	external: ["@workkit/errors", "@standard-schema/spec", "@react-email/render"],
});
