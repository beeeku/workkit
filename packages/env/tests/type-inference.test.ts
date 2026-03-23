import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expectTypeOf, it } from "vitest";
import { parseEnvSync } from "../src/parse";
import type { EnvSchema, InferEnv, InferRawEnv } from "../src/types";
import { ai } from "../src/validators/ai";
import { d1 } from "../src/validators/d1";
import { durableObject } from "../src/validators/do";
import { kv } from "../src/validators/kv";
import { queue } from "../src/validators/queue";
import { r2 } from "../src/validators/r2";
import { service } from "../src/validators/service";

// Helper: create a simple Standard Schema for type tests
function stringSchema(): StandardSchemaV1<string, string> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate(value): StandardSchemaV1.Result<string> {
				if (typeof value !== "string") {
					return { issues: [{ message: "Expected a string" }] };
				}
				return { value };
			},
		},
	};
}

function numberSchema(): StandardSchemaV1<number, number> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate(value): StandardSchemaV1.Result<number> {
				if (typeof value !== "number") {
					return { issues: [{ message: "Expected a number" }] };
				}
				return { value };
			},
		},
	};
}

describe("Type Inference", () => {
	it("infers string from a string Standard Schema", () => {
		const schema = { API_KEY: stringSchema() };
		const env = parseEnvSync({ API_KEY: "test" }, schema);
		expectTypeOf(env.API_KEY).toBeString();
	});

	it("infers number from a number Standard Schema", () => {
		const schema = { PORT: numberSchema() };
		const env = parseEnvSync({ PORT: 3000 }, schema);
		expectTypeOf(env.PORT).toBeNumber();
	});

	it("infers D1Database from d1()", () => {
		const schema = { DB: d1() };
		const mockD1 = { prepare: () => {}, batch: async () => [], exec: async () => ({}) };
		const env = parseEnvSync({ DB: mockD1 }, schema);
		expectTypeOf(env.DB).toEqualTypeOf<D1Database>();
	});

	it("infers KVNamespace from kv()", () => {
		const schema = { CACHE: kv() };
		const mockKV = {
			get: () => {},
			put: () => {},
			delete: () => {},
			list: () => {},
			getWithMetadata: () => {},
		};
		const env = parseEnvSync({ CACHE: mockKV }, schema);
		expectTypeOf(env.CACHE).toEqualTypeOf<KVNamespace>();
	});

	it("infers R2Bucket from r2()", () => {
		const schema = { STORAGE: r2() };
		const mockR2 = {
			get: () => {},
			put: () => {},
			delete: () => {},
			list: () => {},
			head: () => {},
		};
		const env = parseEnvSync({ STORAGE: mockR2 }, schema);
		expectTypeOf(env.STORAGE).toEqualTypeOf<R2Bucket>();
	});

	it("infers DurableObjectNamespace from durableObject()", () => {
		const schema = { COUNTER: durableObject() };
		const mockDO = { get: () => {}, idFromName: () => {}, idFromString: () => {} };
		const env = parseEnvSync({ COUNTER: mockDO }, schema);
		expectTypeOf(env.COUNTER).toEqualTypeOf<DurableObjectNamespace>();
	});

	it("infers Queue from queue()", () => {
		const schema = { TASKS: queue() };
		const mockQueue = { send: () => {}, sendBatch: () => {} };
		const env = parseEnvSync({ TASKS: mockQueue }, schema);
		expectTypeOf(env.TASKS).toEqualTypeOf<Queue>();
	});

	it("infers Ai from ai()", () => {
		const schema = { AI: ai() };
		const mockAi = { run: () => {} };
		const env = parseEnvSync({ AI: mockAi }, schema);
		expectTypeOf(env.AI).toEqualTypeOf<Ai>();
	});

	it("infers Fetcher from service()", () => {
		const schema = { AUTH: service() };
		const mockService = { fetch: () => {} };
		const env = parseEnvSync({ AUTH: mockService }, schema);
		expectTypeOf(env.AUTH).toEqualTypeOf<Fetcher>();
	});

	it("infers mixed types from mixed schema", () => {
		const schema = {
			API_KEY: stringSchema(),
			DB: d1(),
			CACHE: kv(),
			PORT: numberSchema(),
		};
		type Result = InferEnv<typeof schema>;
		expectTypeOf<Result>().toEqualTypeOf<{
			API_KEY: string;
			DB: D1Database;
			CACHE: KVNamespace;
			PORT: number;
		}>();
	});

	it("InferEnv maps each key to its output type", () => {
		const schema = {
			A: stringSchema(),
			B: numberSchema(),
		};
		type Env = InferEnv<typeof schema>;
		expectTypeOf<Env["A"]>().toBeString();
		expectTypeOf<Env["B"]>().toBeNumber();
	});

	it("InferRawEnv maps each key to its input type", () => {
		const schema = {
			A: stringSchema(),
			B: numberSchema(),
		};
		type Raw = InferRawEnv<typeof schema>;
		expectTypeOf<Raw["A"]>().toBeString();
		expectTypeOf<Raw["B"]>().toBeNumber();
	});

	it("EnvSchema accepts a record of StandardSchemaV1 values", () => {
		const schema: EnvSchema = {
			A: stringSchema(),
			B: d1(),
		};
		expectTypeOf(schema).toMatchTypeOf<EnvSchema>();
	});
});
