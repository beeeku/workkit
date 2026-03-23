import { ValidationError } from "@workkit/errors";
import { describe, expect, it, vi } from "vitest";
import type { TypedStorageWrapper } from "../src/types";
import { versionedStorage } from "../src/versioned-storage";
import type { Migration, VersionedStorageOptions } from "../src/versioned-storage";
import { createMockStorage } from "./helpers";

describe("versionedStorage", () => {
	interface TestSchema extends Record<string, unknown> {
		count: number;
		name: string;
	}

	it("should set version on fresh storage", async () => {
		const raw = createMockStorage();
		const store = await versionedStorage<TestSchema>(raw, {
			version: 1,
			migrations: [],
		});

		expect(raw._data.get("__schema_version")).toBe(1);
	});

	it("should return a TypedStorageWrapper", async () => {
		const raw = createMockStorage();
		const store = await versionedStorage<TestSchema>(raw, {
			version: 1,
			migrations: [],
		});

		// Should expose standard wrapper methods
		expect(store.get).toBeTypeOf("function");
		expect(store.put).toBeTypeOf("function");
		expect(store.delete).toBeTypeOf("function");
		expect(store.list).toBeTypeOf("function");
		expect(store.transaction).toBeTypeOf("function");
	});

	it("should not run migrations when at current version", async () => {
		const raw = createMockStorage();
		raw._data.set("__schema_version", 2);

		const migrateFn = vi.fn();
		await versionedStorage<TestSchema>(raw, {
			version: 2,
			migrations: [{ from: 1, to: 2, migrate: migrateFn }],
		});

		expect(migrateFn).not.toHaveBeenCalled();
	});

	it("should run migrations from v1 to v3 sequentially", async () => {
		const raw = createMockStorage();
		raw._data.set("__schema_version", 1);

		const order: number[] = [];
		const migrations: Migration[] = [
			{
				from: 1,
				to: 2,
				migrate: async (storage) => {
					order.push(1);
					const count = await storage.get<number>("count");
					await storage.put("count", (count ?? 0) * 10);
				},
			},
			{
				from: 2,
				to: 3,
				migrate: async (storage) => {
					order.push(2);
					await storage.put("name", "migrated");
				},
			},
		];

		raw._data.set("count", 5);

		await versionedStorage<TestSchema>(raw, {
			version: 3,
			migrations,
		});

		expect(order).toEqual([1, 2]);
		expect(raw._data.get("count")).toBe(50);
		expect(raw._data.get("name")).toBe("migrated");
		expect(raw._data.get("__schema_version")).toBe(3);
	});

	it("should rollback transaction on migration failure", async () => {
		const raw = createMockStorage();
		raw._data.set("__schema_version", 1);
		raw._data.set("count", 42);

		const migrations: Migration[] = [
			{
				from: 1,
				to: 2,
				migrate: async (storage) => {
					await storage.put("count", 999);
					throw new Error("migration failed");
				},
			},
		];

		await expect(
			versionedStorage<TestSchema>(raw, {
				version: 2,
				migrations,
			}),
		).rejects.toThrow("migration failed");

		// Rolled back — original value restored
		expect(raw._data.get("count")).toBe(42);
		expect(raw._data.get("__schema_version")).toBe(1);
	});

	it("should throw ValidationError for non-contiguous migrations", async () => {
		const raw = createMockStorage();
		raw._data.set("__schema_version", 1);

		const migrations: Migration[] = [
			{ from: 1, to: 2, migrate: async () => {} },
			// gap: missing 2→3
			{ from: 3, to: 4, migrate: async () => {} },
		];

		await expect(
			versionedStorage<TestSchema>(raw, {
				version: 4,
				migrations,
			}),
		).rejects.toThrow(ValidationError);
	});

	it("should read and write through the returned wrapper", async () => {
		const raw = createMockStorage();
		const store = await versionedStorage<TestSchema>(raw, {
			version: 1,
			migrations: [],
		});

		await store.put("count", 100);
		const val = await store.get("count");
		expect(val).toBe(100);
	});

	it("should handle fresh storage with migrations available", async () => {
		// Fresh storage (no __schema_version) should assume v1, write target, and run migrations from 1
		const raw = createMockStorage();

		const migrateFn = vi.fn();
		const migrations: Migration[] = [{ from: 1, to: 2, migrate: migrateFn }];

		await versionedStorage<TestSchema>(raw, {
			version: 2,
			migrations,
		});

		expect(migrateFn).toHaveBeenCalledTimes(1);
		expect(raw._data.get("__schema_version")).toBe(2);
	});
});
