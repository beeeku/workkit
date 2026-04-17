import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlags } from "../src/client";
import type { FlagDefinition } from "../src/types";

// ------- Mock KV -------
interface MockKVEntry {
	value: string;
	expiration?: number;
	metadata?: unknown;
}

function createMockKV(): KVNamespace & { _store: Map<string, MockKVEntry> } {
	const store = new Map<string, MockKVEntry>();

	return {
		_store: store,

		async get(key: string, options?: any): Promise<any> {
			const entry = store.get(key);
			if (!entry) return null;
			if (entry.expiration && entry.expiration < Date.now() / 1000) {
				store.delete(key);
				return null;
			}
			const type = typeof options === "string" ? options : (options?.type ?? "text");
			if (type === "json") return JSON.parse(entry.value);
			return entry.value;
		},

		async getWithMetadata(key: string, options?: any): Promise<any> {
			const entry = store.get(key);
			if (!entry) return { value: null, metadata: null, cacheStatus: null };
			if (entry.expiration && entry.expiration < Date.now() / 1000) {
				store.delete(key);
				return { value: null, metadata: null, cacheStatus: null };
			}
			const type = typeof options === "string" ? options : (options?.type ?? "text");
			const value = type === "json" ? JSON.parse(entry.value) : entry.value;
			return { value, metadata: entry.metadata ?? null, cacheStatus: null };
		},

		async put(key: string, value: any, options?: any): Promise<void> {
			const entry: MockKVEntry = {
				value: typeof value === "string" ? value : JSON.stringify(value),
			};
			if (options?.expiration) entry.expiration = options.expiration;
			if (options?.expirationTtl)
				entry.expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
			if (options?.metadata) entry.metadata = options.metadata;
			store.set(key, entry);
		},

		async delete(key: string): Promise<void> {
			store.delete(key);
		},

		async list(options?: any): Promise<any> {
			const prefix = options?.prefix ?? "";
			const limit = options?.limit ?? 1000;
			const entries = [...store.entries()]
				.filter(([k]) => k.startsWith(prefix))
				.sort(([a], [b]) => a.localeCompare(b));

			const startIndex = options?.cursor ? Number.parseInt(options.cursor, 10) : 0;
			const page = entries.slice(startIndex, startIndex + limit);
			const endIndex = startIndex + page.length;
			const listComplete = endIndex >= entries.length;

			return {
				keys: page.map(([name, entry]) => ({
					name,
					expiration: entry.expiration,
					metadata: entry.metadata,
				})),
				list_complete: listComplete,
				cursor: listComplete ? undefined : String(endIndex),
				cacheStatus: null,
			};
		},
	} as any;
}

// ------- Tests -------

describe("createFlags", () => {
	let kv: ReturnType<typeof createMockKV>;

	beforeEach(() => {
		kv = createMockKV();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const sampleFlag: FlagDefinition = {
		key: "dark-mode",
		enabled: true,
		description: "Dark mode feature",
	};

	it("isEnabled returns false for nonexistent flag", async () => {
		const flags = createFlags(kv);
		expect(await flags.isEnabled("nonexistent")).toBe(false);
	});

	it("isEnabled reads flag from KV", async () => {
		kv._store.set("flags:dark-mode", { value: JSON.stringify(sampleFlag) });
		const flags = createFlags(kv);
		expect(await flags.isEnabled("dark-mode")).toBe(true);
	});

	it("setFlag writes to KV and cache", async () => {
		const flags = createFlags(kv);
		await flags.setFlag("new-flag", { key: "new-flag", enabled: true });

		expect(kv._store.has("flags:new-flag")).toBe(true);
		const stored = JSON.parse(kv._store.get("flags:new-flag")!.value);
		expect(stored.enabled).toBe(true);

		// Should also be cached — second read should not hit KV
		const getSpy = vi.spyOn(kv, "get");
		expect(await flags.isEnabled("new-flag")).toBe(true);
		expect(getSpy).not.toHaveBeenCalled();
	});

	it("deleteFlag removes from KV and cache", async () => {
		const flags = createFlags(kv);
		await flags.setFlag("temp", { key: "temp", enabled: true });
		await flags.deleteFlag("temp");

		expect(kv._store.has("flags:temp")).toBe(false);
		expect(await flags.isEnabled("temp")).toBe(false);
	});

	it("listFlags returns all flag definitions", async () => {
		const flags = createFlags(kv);
		await flags.setFlag("flag-a", { key: "flag-a", enabled: true });
		await flags.setFlag("flag-b", { key: "flag-b", enabled: false });

		const all = await flags.listFlags();
		expect(all).toHaveLength(2);
		expect(all.map((f) => f.key).sort()).toEqual(["flag-a", "flag-b"]);
	});

	it("uses custom prefix", async () => {
		const flags = createFlags(kv, { prefix: "custom:" });
		await flags.setFlag("my-flag", { key: "my-flag", enabled: true });

		expect(kv._store.has("custom:my-flag")).toBe(true);
		expect(kv._store.has("flags:my-flag")).toBe(false);
	});

	it("cache expires after TTL", async () => {
		const flags = createFlags(kv, { cacheTtl: 10 });
		await flags.setFlag("cached", { key: "cached", enabled: true });

		// Cached — should return true
		expect(await flags.isEnabled("cached")).toBe(true);

		// Directly modify KV to disable the flag (bypassing cache)
		kv._store.set("flags:cached", {
			value: JSON.stringify({ key: "cached", enabled: false }),
		});

		// Cache still valid — should return true
		expect(await flags.isEnabled("cached")).toBe(true);

		// Advance time past TTL
		vi.advanceTimersByTime(11_000);

		// Cache expired — should re-read from KV and return false
		expect(await flags.isEnabled("cached")).toBe(false);
	});

	it("getAllFlags returns map of all flag states", async () => {
		const flags = createFlags(kv);
		await flags.setFlag("enabled-flag", { key: "enabled-flag", enabled: true });
		await flags.setFlag("disabled-flag", { key: "disabled-flag", enabled: false });

		const all = await flags.getAllFlags();
		expect(all.get("enabled-flag")).toBe(true);
		expect(all.get("disabled-flag")).toBe(false);
	});

	it("getVariant returns variant from KV-stored flag", async () => {
		const flag: FlagDefinition = {
			key: "ab-test",
			enabled: true,
			variants: { control: 50, treatment: 50 },
		};
		const flags = createFlags(kv);
		await flags.setFlag("ab-test", flag);

		const variant = await flags.getVariant("ab-test", { userId: "user-1" });
		expect(variant).toBeDefined();
		expect(["control", "treatment"]).toContain(variant);
	});

	it("getVariant returns null for disabled flag", async () => {
		const flag: FlagDefinition = {
			key: "ab-test",
			enabled: false,
			variants: { control: 50, treatment: 50 },
		};
		const flags = createFlags(kv);
		await flags.setFlag("ab-test", flag);

		expect(await flags.getVariant("ab-test")).toBeNull();
	});

	it("deterministic — same userId + flagKey always gets same result", async () => {
		const flag: FlagDefinition = {
			key: "rollout",
			enabled: true,
			percentage: 50,
		};
		const flags = createFlags(kv);
		await flags.setFlag("rollout", flag);

		const ctx = { userId: "consistent-user" };
		const first = await flags.isEnabled("rollout", ctx);
		const second = await flags.isEnabled("rollout", ctx);
		const third = await flags.isEnabled("rollout", ctx);
		expect(first).toBe(second);
		expect(second).toBe(third);
	});
});
