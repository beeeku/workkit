import { describe, expectTypeOf, it } from "vitest";
import type { TypedMessageBatch } from "../src/bindings";
import type {
	ExecutionContext,
	ScheduledEvent,
	WorkerEmailHandler,
	WorkerFetchHandler,
	WorkerModule,
	WorkerQueueHandler,
	WorkerScheduledHandler,
} from "../src/handler";

type MyEnv = { KV: KVNamespace; SECRET: string };
type MyEvent = { type: string; payload: unknown };

describe("handler types", () => {
	describe("WorkerFetchHandler", () => {
		it("accepts request, env, and ctx", () => {
			type Handler = WorkerFetchHandler<MyEnv>;
			expectTypeOf<Handler>().toBeFunction();
			expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<Request>();
			expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<MyEnv>();
			expectTypeOf<Parameters<Handler>[2]>().toEqualTypeOf<ExecutionContext>();
		});

		it("returns Response or Promise<Response>", () => {
			type Handler = WorkerFetchHandler<MyEnv>;
			expectTypeOf<ReturnType<Handler>>().toMatchTypeOf<Response | Promise<Response>>();
		});
	});

	describe("WorkerScheduledHandler", () => {
		it("receives ScheduledEvent", () => {
			type Handler = WorkerScheduledHandler<MyEnv>;
			expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<ScheduledEvent>();
		});
	});

	describe("WorkerQueueHandler", () => {
		it("receives typed message batch", () => {
			type Handler = WorkerQueueHandler<MyEnv, MyEvent>;
			expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<TypedMessageBatch<MyEvent>>();
		});
	});

	describe("WorkerModule", () => {
		it("all handlers are optional", () => {
			const module: WorkerModule<MyEnv> = {};
			expectTypeOf(module).toMatchTypeOf<WorkerModule<MyEnv>>();
		});

		it("fetch handler matches WorkerFetchHandler", () => {
			type FetchProp = NonNullable<WorkerModule<MyEnv>["fetch"]>;
			expectTypeOf<FetchProp>().toMatchTypeOf<WorkerFetchHandler<MyEnv>>();
		});
	});
});
