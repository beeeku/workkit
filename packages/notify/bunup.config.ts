import { defineConfig } from "bunup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/adapters/email/index.ts",
		"src/adapters/inapp/index.ts",
		"src/adapters/whatsapp/index.ts",
	],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	clean: true,
	target: "browser",
	external: ["@workkit/errors", "@standard-schema/spec", "@react-email/render"],
});
