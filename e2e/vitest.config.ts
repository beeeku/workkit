import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["e2e/**/*.test.ts"],
		root: path.resolve(__dirname, ".."),
	},
	resolve: {
		alias: {
			"@workkit/kv": path.resolve(__dirname, "../packages/kv/src"),
			"@workkit/d1": path.resolve(__dirname, "../packages/d1/src"),
			"@workkit/testing": path.resolve(__dirname, "../packages/testing/src"),
			"@workkit/env": path.resolve(__dirname, "../packages/env/src"),
			"@workkit/errors": path.resolve(__dirname, "../packages/errors/src"),
			"@workkit/crypto": path.resolve(__dirname, "../packages/crypto/src"),
			"@workkit/crypto/envelope": path.resolve(__dirname, "../packages/crypto/src/envelope"),
			"@workkit/crypto/derive": path.resolve(__dirname, "../packages/crypto/src/derive"),
			"@workkit/api": path.resolve(__dirname, "../packages/api/src"),
			"@workkit/auth": path.resolve(__dirname, "../packages/auth/src"),
			"@workkit/ratelimit": path.resolve(__dirname, "../packages/ratelimit/src"),
			"@workkit/cache": path.resolve(__dirname, "../packages/cache/src"),
			"@workkit/types": path.resolve(__dirname, "../packages/types/src"),
		},
	},
});
