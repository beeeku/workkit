import { describe, expect, it, vi } from "vitest";
import { createExecutor } from "../src/executor";
import { createJournal } from "../src/journal";
import type { RetryStrategy, StepDefinition } from "../src/types";

function createMockStorage() {
	const store = new Map<string, any>();
	return {
		get: async <T>(key: string): Promise<T | undefined> => store.get(key),
		put: async (key: string, value: any): Promise<void> => {
			store.set(key, value);
		},
		_store: store,
	};
}

describe("createExecutor", () => {
	it("executes steps in order", async () => {
		const storage = createMockStorage();
		const journal = createJournal(storage);
		const order: string[] = [];

		const steps: StepDefinition[] = [
			{
				name: "a",
				type: "step",
				handler: async () => {
					order.push("a");
					return { a: 1 };
				},
			},
			{
				name: "b",
				type: "step",
				handler: async () => {
					order.push("b");
					return { b: 2 };
				},
			},
			{
				name: "c",
				type: "step",
				handler: async () => {
					order.push("c");
					return { c: 3 };
				},
			},
		];

		const executor = createExecutor(steps, { version: "1.0.0" } as any, storage, journal);
		const result = await executor.execute({ test: true }, "wf_test123");

		expect(result.ok).toBe(true);
		expect(order).toEqual(["a", "b", "c"]);
	});

	it("passes input and prev to each step", async () => {
		const storage = createMockStorage();
		const journal = createJournal(storage);
		const received: any[] = [];

		const steps: StepDefinition[] = [
			{
				name: "first",
				type: "step",
				handler: async (input: any, prev: any) => {
					received.push({ input, prev });
					return { value: 10 };
				},
			},
			{
				name: "second",
				type: "step",
				handler: async (input: any, prev: any) => {
					received.push({ input, prev });
					return { doubled: prev.first.value * 2 };
				},
			},
		];

		const executor = createExecutor(steps, { version: "1.0.0" } as any, storage, journal);
		const result = await executor.execute({ x: 5 }, "wf_test");

		expect(result.ok).toBe(true);
		expect(received[0].input).toEqual({ x: 5 });
		expect(received[0].prev).toEqual({});
		expect(received[1].prev.first).toEqual({ value: 10 });
	});

	it("writes journal entries for each step", async () => {
		const storage = createMockStorage();
		const journal = createJournal(storage);

		const steps: StepDefinition[] = [
			{ name: "a", type: "step", handler: async () => ({ done: true }) },
		];

		const executor = createExecutor(steps, { version: "1.0.0" } as any, storage, journal);
		await executor.execute({}, "wf_test");

		const entries = await journal.readAll();
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("a");
		expect(entries[0].status).toBe("completed");
		expect(entries[0].output).toEqual({ done: true });
	});

	it("handles step failure", async () => {
		const storage = createMockStorage();
		const journal = createJournal(storage);

		const steps: StepDefinition[] = [
			{ name: "ok", type: "step", handler: async () => ({ ok: true }) },
			{
				name: "fail",
				type: "step",
				handler: async () => {
					throw new Error("boom");
				},
			},
		];

		const executor = createExecutor(steps, { version: "1.0.0" } as any, storage, journal);
		const result = await executor.execute({}, "wf_test");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.failedStep).toBe("fail");
			expect(result.error.message).toContain("boom");
		}
	});

	it("skips completed steps on replay", async () => {
		const storage = createMockStorage();
		const journal = createJournal(storage);
		const called: string[] = [];

		// Pre-populate journal with completed step
		await journal.setStepCount(2);
		await journal.writeEntry(0, {
			index: 0,
			name: "a",
			status: "completed",
			input: {},
			output: { cached: true },
			attempt: 1,
		});
		await journal.writeEntry(1, {
			index: 1,
			name: "b",
			status: "pending",
			input: {},
			attempt: 1,
		});

		const steps: StepDefinition[] = [
			{
				name: "a",
				type: "step",
				handler: async () => {
					called.push("a");
					return { cached: true };
				},
			},
			{
				name: "b",
				type: "step",
				handler: async () => {
					called.push("b");
					return { fresh: true };
				},
			},
		];

		const executor = createExecutor(steps, { version: "1.0.0" } as any, storage, journal);
		const result = await executor.execute({}, "wf_test");

		expect(result.ok).toBe(true);
		// "a" should NOT be called — it was already completed
		expect(called).toEqual(["b"]);
	});

	it("retries failed steps", async () => {
		const storage = createMockStorage();
		const journal = createJournal(storage);
		let attempts = 0;

		const steps: StepDefinition[] = [
			{
				name: "flaky",
				type: "step",
				handler: async () => {
					attempts++;
					if (attempts < 3) throw new Error("transient");
					return { ok: true };
				},
				options: { retry: { maxAttempts: 3, initialDelay: 0, maxDelay: 0, backoffMultiplier: 1 } },
			},
		];

		const executor = createExecutor(steps, { version: "1.0.0" } as any, storage, journal);
		const result = await executor.execute({}, "wf_test");

		expect(result.ok).toBe(true);
		expect(attempts).toBe(3);
	});
});
