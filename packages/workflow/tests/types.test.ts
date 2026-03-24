import { describe, expectTypeOf, it } from "vitest";
import type {
	ExecutionHandle,
	ExecutionMeta,
	SerializedStepError,
	StepJournalEntry,
	WorkflowBuilder,
	WorkflowError,
	WorkflowStatus,
} from "../src/types";

describe("WorkflowStatus", () => {
	it("accepts all valid status values", () => {
		const statuses: WorkflowStatus[] = [
			"pending",
			"running",
			"completed",
			"failed",
			"cancelled",
			"waiting",
			"sleeping",
		];
		expectTypeOf(statuses).toMatchTypeOf<WorkflowStatus[]>();
	});

	it("is a string union type", () => {
		expectTypeOf<WorkflowStatus>().toEqualTypeOf<
			"pending" | "running" | "completed" | "failed" | "cancelled" | "waiting" | "sleeping"
		>();
	});
});

describe("StepJournalEntry", () => {
	it("has required fields", () => {
		expectTypeOf<StepJournalEntry>().toHaveProperty("index");
		expectTypeOf<StepJournalEntry>().toHaveProperty("name");
		expectTypeOf<StepJournalEntry>().toHaveProperty("status");
		expectTypeOf<StepJournalEntry>().toHaveProperty("input");
		expectTypeOf<StepJournalEntry>().toHaveProperty("attempt");
	});

	it("has optional fields", () => {
		expectTypeOf<StepJournalEntry>().toHaveProperty("output");
		expectTypeOf<StepJournalEntry>().toHaveProperty("error");
		expectTypeOf<StepJournalEntry>().toHaveProperty("startedAt");
		expectTypeOf<StepJournalEntry>().toHaveProperty("completedAt");
		expectTypeOf<StepJournalEntry>().toHaveProperty("duration");
	});

	it("is generic over output type", () => {
		expectTypeOf<StepJournalEntry<string>>().toHaveProperty("output");
		expectTypeOf<StepJournalEntry<number>>().toHaveProperty("output");
	});

	it("status field accepts valid values", () => {
		type EntryStatus = StepJournalEntry["status"];
		expectTypeOf<EntryStatus>().toEqualTypeOf<
			"pending" | "running" | "completed" | "failed" | "skipped"
		>();
	});
});

describe("SerializedStepError", () => {
	it("has required fields", () => {
		expectTypeOf<SerializedStepError>().toHaveProperty("name");
		expectTypeOf<SerializedStepError>().toHaveProperty("message");
		expectTypeOf<SerializedStepError>().toHaveProperty("retryable");
	});

	it("has optional code field", () => {
		expectTypeOf<SerializedStepError>().toHaveProperty("code");
	});
});

describe("ExecutionHandle", () => {
	it("has executionId property", () => {
		expectTypeOf<ExecutionHandle>().toHaveProperty("executionId");
	});

	it("has status method returning Promise<WorkflowStatus>", () => {
		expectTypeOf<ExecutionHandle["status"]>().toEqualTypeOf<() => Promise<WorkflowStatus>>();
	});

	it("has result method returning Promise of ok/error union", () => {
		type Result = Awaited<ReturnType<ExecutionHandle["result"]>>;
		expectTypeOf<Result>().toEqualTypeOf<
			{ ok: true; value: unknown } | { ok: false; error: WorkflowError }
		>();
	});

	it("has meta method returning Promise<ExecutionMeta>", () => {
		expectTypeOf<ExecutionHandle["meta"]>().toEqualTypeOf<() => Promise<ExecutionMeta>>();
	});

	it("has journal method returning Promise<StepJournalEntry[]>", () => {
		expectTypeOf<ExecutionHandle["journal"]>().toEqualTypeOf<() => Promise<StepJournalEntry[]>>();
	});

	it("has resume method", () => {
		expectTypeOf<ExecutionHandle["resume"]>().toEqualTypeOf<
			(event: string, payload?: unknown) => Promise<void>
		>();
	});

	it("has cancel method", () => {
		expectTypeOf<ExecutionHandle["cancel"]>().toEqualTypeOf<() => Promise<void>>();
	});

	it("is generic over output type", () => {
		type StringHandle = ExecutionHandle<string>;
		type NumberHandle = ExecutionHandle<number>;
		expectTypeOf<StringHandle>().not.toEqualTypeOf<NumberHandle>();
	});
});

describe("WorkflowBuilder step chain types", () => {
	it("step method is a function", () => {
		type Builder = WorkflowBuilder<{ userId: string }, {}>;
		expectTypeOf<Builder["step"]>().toBeFunction();
	});

	it("has build method returning WorkflowDef", () => {
		type Builder = WorkflowBuilder<unknown, {}>;
		expectTypeOf<Builder["build"]>().toBeFunction();
	});

	it("has onFailure method", () => {
		type Builder = WorkflowBuilder<unknown, {}>;
		expectTypeOf<Builder["onFailure"]>().toBeFunction();
	});

	it("step method returns WorkflowBuilder", () => {
		type Builder = WorkflowBuilder<{ userId: string }, {}>;
		type StepFn = Builder["step"];
		// step returns a WorkflowBuilder (same type family)
		expectTypeOf<ReturnType<StepFn>>().toMatchTypeOf<WorkflowBuilder<any, any>>();
	});
});
