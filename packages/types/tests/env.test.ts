import { describe, expectTypeOf, it } from "vitest";
import type {
	BindingDef,
	BindingTypeCheck,
	EnvParseFailure,
	EnvParseResult,
	EnvParseSuccess,
	EnvSchema,
	EnvValidationError,
	InferEnv,
} from "../src/env";

describe("env types", () => {
	describe("BindingTypeCheck", () => {
		it("has bindingType and validate", () => {
			const check: BindingTypeCheck = {
				__bindingType: "KVNamespace",
				validate: (value: unknown) => value != null,
			};
			expectTypeOf(check.__bindingType).toBeString();
			expectTypeOf(check.validate).toBeFunction();
		});
	});

	describe("EnvSchema", () => {
		it("is a record of BindingDef", () => {
			expectTypeOf<EnvSchema>().toMatchTypeOf<Record<string, BindingDef>>();
		});
	});

	describe("EnvParseResult", () => {
		it("discriminates on success field", () => {
			type ParseResult = EnvParseResult<{ API_KEY: string }>;

			const success: EnvParseSuccess<{ API_KEY: string }> = {
				success: true,
				env: { API_KEY: "test" },
			};
			expectTypeOf(success).toMatchTypeOf<ParseResult>();

			const failure: EnvParseFailure = {
				success: false,
				errors: [
					{
						binding: "API_KEY",
						message: "missing",
						expected: "string",
						received: "undefined",
					},
				],
			};
			expectTypeOf(failure).toMatchTypeOf<ParseResult>();
		});

		it("narrows correctly on success", () => {
			const result = {} as EnvParseResult<{ API_KEY: string }>;
			if (result.success) {
				expectTypeOf(result.env).toEqualTypeOf<{ API_KEY: string }>();
			} else {
				expectTypeOf(result.errors).toMatchTypeOf<EnvValidationError[]>();
			}
		});
	});

	describe("EnvValidationError", () => {
		it("has the correct shape", () => {
			const err: EnvValidationError = {
				binding: "DB",
				message: "not a D1Database",
				expected: "D1Database",
				received: "undefined",
			};
			expectTypeOf(err.binding).toBeString();
			expectTypeOf(err.message).toBeString();
			expectTypeOf(err.expected).toBeString();
			expectTypeOf(err.received).toBeString();
		});
	});

	describe("InferEnv", () => {
		it("maps BindingTypeCheck to its binding type", () => {
			type KVCheck = {
				readonly __bindingType: "KVNamespace";
				readonly validate: (value: unknown) => boolean;
			};
			type Schema = { MY_KV: KVCheck };
			type Env = InferEnv<Schema>;
			expectTypeOf<Env["MY_KV"]>().toEqualTypeOf<KVNamespace>();
		});

		it("falls back to unknown for unrecognized binding types", () => {
			type CustomCheck = {
				readonly __bindingType: "Custom";
				readonly validate: (value: unknown) => boolean;
			};
			type Schema = { CUSTOM: CustomCheck };
			type Env = InferEnv<Schema>;
			expectTypeOf<Env["CUSTOM"]>().toBeUnknown();
		});
	});
});
