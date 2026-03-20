import { expectTypeOf } from "expect-type";
import { describe, expect, it } from "vitest";
import {
	defineEnv,
	getBinding,
	getCFProperties,
	getOptionalBinding,
	getWaitUntil,
	workkitMiddleware,
} from "../src/index";
import type {
	AstroAPIContext,
	AstroMiddlewareHandler,
	CfProperties,
	EnvAccessor,
} from "../src/types";
import { createMockContext, numberValidator, stringValidator } from "./helpers";

describe("type safety", () => {
	describe("defineEnv return types", () => {
		it("infers correct types from schema", () => {
			const env = defineEnv({
				API_KEY: stringValidator(),
				PORT: numberValidator(),
			});
			const context = createMockContext({
				env: { API_KEY: "key", PORT: "3000" },
			});

			const result = env(context);

			// Runtime check
			expect(typeof result.API_KEY).toBe("string");
			expect(typeof result.PORT).toBe("number");
		});

		it("accessor has schema property", () => {
			const schema = { KEY: stringValidator() };
			const env = defineEnv(schema);

			expectTypeOf(env.schema).toEqualTypeOf(schema);
		});
	});

	describe("getBinding types", () => {
		it("returns typed binding", () => {
			const context = createMockContext({ env: { KEY: "value" } });
			const result = getBinding<string>(context, "KEY");

			expectTypeOf(result).toBeString();
		});

		it("defaults to unknown type", () => {
			const context = createMockContext({ env: { KEY: "value" } });
			const result = getBinding(context, "KEY");

			expectTypeOf(result).toBeUnknown();
		});
	});

	describe("getOptionalBinding types", () => {
		it("returns T | undefined", () => {
			const context = createMockContext({ env: {} });
			const result = getOptionalBinding<string>(context, "KEY");

			expectTypeOf(result).toEqualTypeOf<string | undefined>();
		});
	});

	describe("getCFProperties types", () => {
		it("returns CfProperties | undefined", () => {
			const context = createMockContext({ env: {} });
			const result = getCFProperties(context);

			expectTypeOf(result).toEqualTypeOf<CfProperties | undefined>();
		});
	});

	describe("getWaitUntil types", () => {
		it("returns a function accepting Promise<unknown>", () => {
			const context = createMockContext({
				env: {},
				ctx: { waitUntil: () => {} },
			});
			const waitUntil = getWaitUntil(context);

			expectTypeOf(waitUntil).toBeFunction();
			expectTypeOf(waitUntil).parameter(0).toEqualTypeOf<Promise<unknown>>();
		});
	});

	describe("workkitMiddleware types", () => {
		it("returns an AstroMiddlewareHandler", () => {
			const middleware = workkitMiddleware({
				env: { KEY: stringValidator() },
			});

			expectTypeOf(middleware).toMatchTypeOf<AstroMiddlewareHandler>();
		});
	});

	describe("re-exports", () => {
		it("exports all expected functions", () => {
			expect(typeof defineEnv).toBe("function");
			expect(typeof getBinding).toBe("function");
			expect(typeof getOptionalBinding).toBe("function");
			expect(typeof getCFProperties).toBe("function");
			expect(typeof getWaitUntil).toBe("function");
			expect(typeof workkitMiddleware).toBe("function");
		});
	});
});
