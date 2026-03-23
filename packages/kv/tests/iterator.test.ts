import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { createKeysIterator, createValueListIterator } from "../src/iterator";
import { jsonSerializer, textSerializer } from "../src/serializer";

/** Helper: create a mock KVNamespace with cursor pagination support */
function createPaginatedMock(
	data: Array<{ name: string; value: string; expiration?: number; metadata?: unknown }>,
	pageSize = 1000,
): KVNamespace {
	return {
		async get(key: string, _type?: any) {
			const item = data.find((d) => d.name === key);
			return item?.value ?? null;
		},
		async getWithMetadata(key: string, _type?: any) {
			const item = data.find((d) => d.name === key);
			return {
				value: item?.value ?? null,
				metadata: item?.metadata ?? null,
			};
		},
		async put() {},
		async delete() {},
		async list(opts?: any) {
			const prefix = opts?.prefix ?? "";
			const limit = opts?.limit ?? pageSize;
			const filtered = data.filter((d) => d.name.startsWith(prefix));
			const startIndex = opts?.cursor ? Number.parseInt(opts.cursor, 10) : 0;
			const page = filtered.slice(startIndex, startIndex + limit);
			const endIndex = startIndex + page.length;
			const listComplete = endIndex >= filtered.length;

			return {
				keys: page.map((d) => ({
					name: d.name,
					expiration: d.expiration,
					metadata: d.metadata,
				})),
				list_complete: listComplete,
				cursor: listComplete ? undefined : String(endIndex),
				cacheStatus: null,
			};
		},
	} as unknown as KVNamespace;
}

describe("createValueListIterator", () => {
	it("yields entries from a single page", async () => {
		const mock = createPaginatedMock([
			{ name: "a", value: '{"x":1}' },
			{ name: "b", value: '{"x":2}' },
		]);

		const entries = [];
		for await (const entry of createValueListIterator(mock, { serializer: jsonSerializer })) {
			entries.push(entry);
		}

		expect(entries).toHaveLength(2);
		expect(entries[0]!.key).toBe("a");
		expect(entries[0]!.value).toEqual({ x: 1 });
		expect(entries[1]!.key).toBe("b");
		expect(entries[1]!.value).toEqual({ x: 2 });
	});

	it("handles cursor pagination across multiple pages", async () => {
		const data = Array.from({ length: 5 }, (_, i) => ({
			name: `key${i}`,
			value: JSON.stringify({ i }),
		}));
		const mock = createPaginatedMock(data, 2); // 2 per page

		const entries = [];
		for await (const entry of createValueListIterator(mock, { serializer: jsonSerializer })) {
			entries.push(entry);
		}

		expect(entries).toHaveLength(5);
		expect(entries.map((e) => e.key)).toEqual(["key0", "key1", "key2", "key3", "key4"]);
	});

	it("stops after limit is reached", async () => {
		const data = Array.from({ length: 10 }, (_, i) => ({
			name: `key${i}`,
			value: JSON.stringify({ i }),
		}));
		const mock = createPaginatedMock(data, 5);

		const entries = [];
		for await (const entry of createValueListIterator(mock, {
			serializer: jsonSerializer,
			limit: 3,
		})) {
			entries.push(entry);
		}

		expect(entries).toHaveLength(3);
	});

	it("handles empty results", async () => {
		const mock = createPaginatedMock([]);

		const entries = [];
		for await (const entry of createValueListIterator(mock, { serializer: jsonSerializer })) {
			entries.push(entry);
		}

		expect(entries).toHaveLength(0);
	});

	it("deserializes values using the provided serializer", async () => {
		const mock = createPaginatedMock([{ name: "a", value: "hello world" }]);

		const entries = [];
		for await (const entry of createValueListIterator<string>(mock, {
			serializer: textSerializer,
		})) {
			entries.push(entry);
		}

		expect(entries[0]!.value).toBe("hello world");
	});

	it("validates values against schema", async () => {
		const mock = createPaginatedMock([{ name: "a", value: '{"name":"valid"}' }]);

		const schema: StandardSchemaV1<unknown, { name: string }> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (v: unknown) => ({ value: v as { name: string } }),
			},
		};

		const entries = [];
		for await (const entry of createValueListIterator(mock, {
			serializer: jsonSerializer,
			schema,
		})) {
			entries.push(entry);
		}

		expect(entries[0]!.value).toEqual({ name: "valid" });
	});

	it("yields null value on deserialization failure", async () => {
		const mock = createPaginatedMock([{ name: "a", value: "not-json" }]);

		const entries = [];
		for await (const entry of createValueListIterator(mock, { serializer: jsonSerializer })) {
			entries.push(entry);
		}

		expect(entries[0]!.value).toBeNull();
	});

	it("yields null value on validation failure", async () => {
		const mock = createPaginatedMock([{ name: "a", value: '{"bad":true}' }]);

		const schema: StandardSchemaV1<unknown, never> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: () => ({ issues: [{ message: "fail" }] }),
			},
		};

		const entries = [];
		for await (const entry of createValueListIterator(mock, {
			serializer: jsonSerializer,
			schema,
		})) {
			entries.push(entry);
		}

		expect(entries[0]!.value).toBeNull();
	});
});

describe("createKeysIterator", () => {
	it("yields key entries without fetching values", async () => {
		const mock = createPaginatedMock([
			{ name: "a", value: "x" },
			{ name: "b", value: "y" },
		]);

		const entries = [];
		for await (const entry of createKeysIterator(mock, {})) {
			entries.push(entry);
		}

		expect(entries).toHaveLength(2);
		expect(entries[0]!.key).toBe("a");
		expect(entries[1]!.key).toBe("b");
		// No value field on key entries
		expect((entries[0] as any).value).toBeUndefined();
	});

	it("handles cursor pagination", async () => {
		const data = Array.from({ length: 5 }, (_, i) => ({
			name: `k${i}`,
			value: "v",
		}));
		const mock = createPaginatedMock(data, 2);

		const entries = [];
		for await (const entry of createKeysIterator(mock, {})) {
			entries.push(entry);
		}

		expect(entries).toHaveLength(5);
	});

	it("stops after limit", async () => {
		const data = Array.from({ length: 10 }, (_, i) => ({
			name: `k${i}`,
			value: "v",
		}));
		const mock = createPaginatedMock(data, 5);

		const entries = [];
		for await (const entry of createKeysIterator(mock, { limit: 4 })) {
			entries.push(entry);
		}

		expect(entries).toHaveLength(4);
	});
});
