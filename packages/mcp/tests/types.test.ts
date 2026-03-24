// tests/types.test.ts
import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type {
	InferOutput,
	MCPAuthConfig,
	MCPServerConfig,
	MCPSessionConfig,
	Middleware,
	MiddlewareNext,
	PromptConfig,
	ResourceConfig,
	StandardSchemaV1,
	ToolAnnotations,
	ToolConfig,
	ToolHandlerContext,
	WorkerModule,
} from "../src/types";

describe("types", () => {
	it("MCPServerConfig accepts minimal config", () => {
		const config: MCPServerConfig = {
			name: "test",
			version: "1.0.0",
		};
		expectTypeOf(config.name).toBeString();
		expectTypeOf(config.version).toBeString();
	});

	it("ToolConfig infers input/output types from Zod schemas", () => {
		const input = z.object({ query: z.string() });
		const output = z.object({ results: z.array(z.string()) });

		type InputType = InferOutput<typeof input>;
		type OutputType = InferOutput<typeof output>;

		expectTypeOf<InputType>().toEqualTypeOf<{ query: string }>();
		expectTypeOf<OutputType>().toEqualTypeOf<{ results: string[] }>();
	});

	it("ToolAnnotations has correct shape", () => {
		const annotations: ToolAnnotations = {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		};
		expectTypeOf(annotations.readOnlyHint).toEqualTypeOf<boolean | undefined>();
	});

	it("Middleware type matches @workkit/api pattern", () => {
		type TestMiddleware = Middleware<{ DB: unknown }>;
		expectTypeOf<TestMiddleware>().toBeFunction();
	});

	it("WorkerModule has fetch method", () => {
		type Module = WorkerModule<unknown>;
		expectTypeOf<Module["fetch"]>().toBeFunction();
	});
});
