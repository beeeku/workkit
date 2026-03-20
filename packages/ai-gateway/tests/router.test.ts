import { ConfigError } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { createRouter } from "../src/router";

describe("createRouter()", () => {
	it("throws ConfigError with empty routes", () => {
		expect(() => createRouter({ routes: [], fallback: "default" })).toThrow(ConfigError);
	});

	it("throws ConfigError without fallback", () => {
		expect(() =>
			createRouter({
				routes: [{ pattern: "gpt-*", provider: "openai" }],
				fallback: "",
			}),
		).toThrow(ConfigError);
	});

	it("throws ConfigError for route with empty pattern", () => {
		expect(() =>
			createRouter({
				routes: [{ pattern: "", provider: "openai" }],
				fallback: "default",
			}),
		).toThrow(ConfigError);
	});

	it("throws ConfigError for route with empty provider", () => {
		expect(() =>
			createRouter({
				routes: [{ pattern: "gpt-*", provider: "" }],
				fallback: "default",
			}),
		).toThrow(ConfigError);
	});

	it("creates a router with valid config", () => {
		const router = createRouter({
			routes: [{ pattern: "gpt-*", provider: "openai" }],
			fallback: "workers-ai",
		});
		expect(router).toBeDefined();
		expect(typeof router.resolve).toBe("function");
		expect(typeof router.routes).toBe("function");
	});
});

describe("resolve()", () => {
	const router = createRouter({
		routes: [
			{ pattern: "gpt-*", provider: "openai" },
			{ pattern: "claude-*", provider: "anthropic" },
			{ pattern: "@cf/*", provider: "workers-ai" },
			{ pattern: "llama-3.1-*", provider: "together" },
		],
		fallback: "workers-ai",
	});

	it("matches gpt-4 to openai", () => {
		expect(router.resolve("gpt-4")).toBe("openai");
	});

	it("matches gpt-3.5-turbo to openai", () => {
		expect(router.resolve("gpt-3.5-turbo")).toBe("openai");
	});

	it("matches gpt-4o to openai", () => {
		expect(router.resolve("gpt-4o")).toBe("openai");
	});

	it("matches claude-3-opus to anthropic", () => {
		expect(router.resolve("claude-3-opus")).toBe("anthropic");
	});

	it("matches claude-3-sonnet to anthropic", () => {
		expect(router.resolve("claude-3-sonnet")).toBe("anthropic");
	});

	it("matches claude-3.5-sonnet to anthropic", () => {
		expect(router.resolve("claude-3.5-sonnet")).toBe("anthropic");
	});

	it("matches @cf/meta/llama-3.1-8b-instruct to workers-ai", () => {
		expect(router.resolve("@cf/meta/llama-3.1-8b-instruct")).toBe("workers-ai");
	});

	it("matches @cf/mistral/mistral-7b to workers-ai", () => {
		expect(router.resolve("@cf/mistral/mistral-7b")).toBe("workers-ai");
	});

	it("matches llama-3.1-70b to together", () => {
		expect(router.resolve("llama-3.1-70b")).toBe("together");
	});

	it("returns fallback for unknown model", () => {
		expect(router.resolve("some-unknown-model")).toBe("workers-ai");
	});

	it("returns fallback for empty string", () => {
		expect(router.resolve("")).toBe("workers-ai");
	});

	it("first match wins when multiple routes match", () => {
		const r = createRouter({
			routes: [
				{ pattern: "gpt-4*", provider: "openai-premium" },
				{ pattern: "gpt-*", provider: "openai-basic" },
			],
			fallback: "default",
		});
		expect(r.resolve("gpt-4")).toBe("openai-premium");
		expect(r.resolve("gpt-4o")).toBe("openai-premium");
		expect(r.resolve("gpt-3.5-turbo")).toBe("openai-basic");
	});

	it("matches case-insensitively", () => {
		const r = createRouter({
			routes: [{ pattern: "GPT-*", provider: "openai" }],
			fallback: "default",
		});
		expect(r.resolve("gpt-4")).toBe("openai");
		expect(r.resolve("GPT-4")).toBe("openai");
	});

	it("handles exact match (no wildcard)", () => {
		const r = createRouter({
			routes: [{ pattern: "my-model", provider: "custom" }],
			fallback: "default",
		});
		expect(r.resolve("my-model")).toBe("custom");
		expect(r.resolve("my-model-2")).toBe("default");
	});

	it("handles pattern with multiple wildcards", () => {
		const r = createRouter({
			routes: [{ pattern: "@*/*", provider: "namespaced" }],
			fallback: "default",
		});
		expect(r.resolve("@cf/meta")).toBe("namespaced");
		expect(r.resolve("@hf/model")).toBe("namespaced");
		expect(r.resolve("no-namespace")).toBe("default");
	});
});

describe("routes()", () => {
	it("returns readonly array of routes", () => {
		const routes = [
			{ pattern: "gpt-*", provider: "openai" },
			{ pattern: "claude-*", provider: "anthropic" },
		];
		const router = createRouter({ routes, fallback: "default" });
		const result = router.routes();
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ pattern: "gpt-*", provider: "openai" });
		expect(result[1]).toEqual({ pattern: "claude-*", provider: "anthropic" });
	});

	it("routes are frozen (immutable)", () => {
		const router = createRouter({
			routes: [{ pattern: "gpt-*", provider: "openai" }],
			fallback: "default",
		});
		const routes = router.routes();
		expect(() => {
			(routes as any).push({ pattern: "new", provider: "new" });
		}).toThrow();
	});

	it("modifying original routes array does not affect router", () => {
		const routes = [{ pattern: "gpt-*", provider: "openai" }];
		const router = createRouter({ routes, fallback: "default" });
		routes.push({ pattern: "claude-*", provider: "anthropic" });
		expect(router.routes()).toHaveLength(1);
	});
});
