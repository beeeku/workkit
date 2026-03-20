import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { api } from "../src/define";
import type {
	ApiDefinition,
	ExtractPathParams,
	HandlerContext,
	InferInput,
	InferOutput,
	PathParamRecord,
} from "../src/types";

describe("type inference", () => {
	describe("ExtractPathParams", () => {
		it("extracts single param", () => {
			expectTypeOf<ExtractPathParams<"/users/:id">>().toEqualTypeOf<"id">();
		});

		it("extracts multiple params", () => {
			expectTypeOf<ExtractPathParams<"/users/:id/posts/:postId">>().toEqualTypeOf<
				"id" | "postId"
			>();
		});

		it("returns never for no params", () => {
			expectTypeOf<ExtractPathParams<"/users">>().toEqualTypeOf<never>();
		});
	});

	describe("PathParamRecord", () => {
		it("creates record from params", () => {
			expectTypeOf<PathParamRecord<"/users/:id">>().toEqualTypeOf<{
				id: string;
			}>();
		});

		it("creates empty record for no params", () => {
			expectTypeOf<PathParamRecord<"/users">>().toEqualTypeOf<Record<string, never>>();
		});
	});

	describe("InferOutput", () => {
		it("infers zod output type", () => {
			const schema = z.object({ name: z.string(), age: z.number() });
			expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<{
				name: string;
				age: number;
			}>();
		});

		it("infers transformed output", () => {
			const schema = z.string().transform((s) => s.length);
			expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<number>();
		});
	});

	describe("InferInput", () => {
		it("infers zod input type", () => {
			const schema = z.object({ name: z.string() });
			expectTypeOf<InferInput<typeof schema>>().toEqualTypeOf<{
				name: string;
			}>();
		});
	});

	describe("api() type inference", () => {
		it("infers handler context types from schemas", () => {
			const def = api({
				method: "POST" as const,
				path: "/users" as const,
				body: z.object({ name: z.string() }),
				response: z.object({ id: z.string() }),
				handler: async ({ body }) => {
					expectTypeOf(body).toEqualTypeOf<{ name: string }>();
					return { id: "123" };
				},
			});

			expectTypeOf(def.method).toEqualTypeOf<"POST">();
			expectTypeOf(def.path).toEqualTypeOf<"/users">();
		});

		it("infers params from path when no schema provided", () => {
			api({
				method: "GET" as const,
				path: "/users/:id" as const,
				handler: async ({ params }) => {
					// Without params schema, params should be PathParamRecord
					expectTypeOf(params).toHaveProperty("id");
					return {};
				},
			});
		});

		it("infers params from schema when provided", () => {
			api({
				method: "GET" as const,
				path: "/users/:id" as const,
				params: z.object({ id: z.string().uuid() }),
				handler: async ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>();
					return {};
				},
			});
		});

		it("returns branded ApiDefinition", () => {
			const def = api({
				method: "GET",
				path: "/users",
				handler: async () => [],
			});

			expectTypeOf(def.__brand).toEqualTypeOf<"ApiDefinition">();
		});
	});
});
