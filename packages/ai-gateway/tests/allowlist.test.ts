import { describe, expect, it } from "vitest";
import { type AllowlistConfig, createModelAllowlist, isAllowedModel } from "../src/allowlist/index";

describe("createModelAllowlist", () => {
	it("allows an exact string match for the given provider", () => {
		const allow = createModelAllowlist({
			anthropic: ["claude-opus-4-7", "claude-sonnet-4-6"],
		});
		expect(allow.isAllowed("anthropic", "claude-opus-4-7")).toBe(true);
	});

	it("rejects models that are not in the exact allowlist for that provider", () => {
		const allow = createModelAllowlist({
			anthropic: ["claude-opus-4-7"],
		});
		expect(allow.isAllowed("anthropic", "claude-sonnet-4-6")).toBe(false);
	});

	it("allows a prefix match when a ModelRule with `prefix` is configured", () => {
		const allow = createModelAllowlist({
			groq: [{ prefix: "llama-3.1-" }],
		});
		expect(allow.isAllowed("groq", "llama-3.1-70b-versatile")).toBe(true);
		expect(allow.isAllowed("groq", "llama-3.1-8b-instant")).toBe(true);
	});

	it("rejects models that do not start with any configured prefix", () => {
		const allow = createModelAllowlist({
			groq: [{ prefix: "llama-3.1-" }],
		});
		expect(allow.isAllowed("groq", "llama-3-70b")).toBe(false);
		expect(allow.isAllowed("groq", "mixtral-8x7b")).toBe(false);
	});

	it("returns false for an unknown provider, even if the model string is present under another provider", () => {
		const allow = createModelAllowlist({
			anthropic: ["claude-opus-4-7"],
		});
		expect(allow.isAllowed("openai", "claude-opus-4-7")).toBe(false);
		expect(allow.isAllowed("does-not-exist", "anything")).toBe(false);
	});

	it("returns false for a provider configured with an empty matcher array", () => {
		const allow = createModelAllowlist({
			anthropic: [],
		});
		expect(allow.isAllowed("anthropic", "claude-opus-4-7")).toBe(false);
	});

	it("returns false for any query when the allowlist config is fully empty", () => {
		const allow = createModelAllowlist({});
		expect(allow.isAllowed("anthropic", "claude-opus-4-7")).toBe(false);
	});

	it("supports mixing exact and prefix matchers under the same provider", () => {
		const allow = createModelAllowlist({
			openai: ["gpt-4o", { prefix: "gpt-4o-mini" }],
		});
		expect(allow.isAllowed("openai", "gpt-4o")).toBe(true);
		expect(allow.isAllowed("openai", "gpt-4o-mini")).toBe(true);
		expect(allow.isAllowed("openai", "gpt-4o-mini-2024-07-18")).toBe(true);
		expect(allow.isAllowed("openai", "gpt-5-preview")).toBe(false);
	});
});

describe("isAllowedModel (functional form)", () => {
	it("delegates to createModelAllowlist with the same semantics", () => {
		const config: AllowlistConfig = {
			anthropic: ["claude-opus-4-7"],
			groq: [{ prefix: "llama-3.1-" }],
		};
		expect(isAllowedModel(config, "anthropic", "claude-opus-4-7")).toBe(true);
		expect(isAllowedModel(config, "anthropic", "claude-sonnet-4-6")).toBe(false);
		expect(isAllowedModel(config, "groq", "llama-3.1-70b-versatile")).toBe(true);
		expect(isAllowedModel(config, "groq", "mixtral-8x7b")).toBe(false);
		expect(isAllowedModel(config, "openai", "gpt-4o")).toBe(false);
	});

	it("produces the same result as the object form for the same inputs", () => {
		const config: AllowlistConfig = {
			openai: ["gpt-4o", { prefix: "gpt-4o-mini" }],
		};
		const allow = createModelAllowlist(config);
		const pairs: Array<[string, string]> = [
			["openai", "gpt-4o"],
			["openai", "gpt-4o-mini-2024-07-18"],
			["openai", "gpt-5"],
			["anthropic", "gpt-4o"],
		];
		for (const [provider, model] of pairs) {
			expect(isAllowedModel(config, provider, model)).toBe(allow.isAllowed(provider, model));
		}
	});
});
