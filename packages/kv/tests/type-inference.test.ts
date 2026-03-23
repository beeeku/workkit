import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { kv } from "../src/client";
import type { KVEntry, KVKeyEntry } from "../src/types";
import { createMockKV } from "./helpers/mock-kv";

type User = { name: string; email: string };

describe("type inference", () => {
	const mockNamespace = createMockKV();

	it("infers value type from generic parameter", () => {
		const users = kv<User>(mockNamespace);
		expectTypeOf(users.get("123")).resolves.toEqualTypeOf<User | null>();
	});

	it("infers value type from Standard Schema", () => {
		const schema = z.object({ name: z.string() });
		const users = kv(mockNamespace, { schema });
		expectTypeOf(users.get("123")).resolves.toEqualTypeOf<{ name: string } | null>();
	});

	it("put accepts the correct value type", () => {
		const users = kv<User>(mockNamespace);
		// This should compile fine
		expectTypeOf(users.put).parameter(1).toEqualTypeOf<User>();
	});

	it("getMany returns Map with correct types", () => {
		const users = kv<User>(mockNamespace);
		expectTypeOf(users.getMany(["a"])).resolves.toEqualTypeOf<Map<string, User | null>>();
	});

	it("list returns AsyncIterable of KVEntry<T>", () => {
		const users = kv<User>(mockNamespace);
		expectTypeOf(users.list()).toEqualTypeOf<AsyncIterable<KVEntry<User>>>();
	});

	it("keys returns AsyncIterable of KVKeyEntry", () => {
		const users = kv<User>(mockNamespace);
		expectTypeOf(users.keys()).toEqualTypeOf<AsyncIterable<KVKeyEntry>>();
	});

	it("getWithMetadata returns typed result", () => {
		const users = kv<User>(mockNamespace);
		type Meta = { role: string };
		const result = users.getWithMetadata<Meta>("123");
		expectTypeOf(result).resolves.toMatchTypeOf<{ value: User | null; metadata: Meta | null }>();
	});

	it("exists returns boolean", () => {
		const users = kv<User>(mockNamespace);
		expectTypeOf(users.exists("123")).resolves.toEqualTypeOf<boolean>();
	});
});
