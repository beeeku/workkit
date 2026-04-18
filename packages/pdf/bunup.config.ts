import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	clean: true,
	external: ["@workkit/browser", "@workkit/errors", "@cloudflare/puppeteer"],
});
