import { describe, expect, it, vi } from "vitest";
import { createWorkflowExecutionLogic } from "../src/do";

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

describe("WorkflowExecutionLogic", () => {
	it("executes steps and returns result", async () => {
		const storage = createMockStorage();
		const logic = createWorkflowExecutionLogic(storage);

		const result = await logic.execute(
			{ x: 1 },
			"wf_test",
			[
				{
					name: "double",
					type: "step",
					handler: async (input: any) => ({ result: input.x * 2 }),
				},
			],
			{
				version: "1.0.0",
				backend: { type: "do", namespace: {} as any },
			},
		);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.double).toEqual({ result: 2 });
	});

	it("getStatus returns execution metadata", async () => {
		const storage = createMockStorage();
		const logic = createWorkflowExecutionLogic(storage);

		await logic.execute({}, "wf_test", [{ name: "a", type: "step", handler: async () => ({}) }], {
			version: "1.0.0",
			backend: { type: "do", namespace: {} as any },
		});

		const status = await logic.getStatus();
		expect(status).toBeDefined();
		expect(status!.status).toBe("completed");
	});

	it("getJournal returns step entries", async () => {
		const storage = createMockStorage();
		const logic = createWorkflowExecutionLogic(storage);

		await logic.execute(
			{},
			"wf_test",
			[
				{
					name: "a",
					type: "step",
					handler: async () => ({ done: true }),
				},
			],
			{ version: "1.0.0", backend: { type: "do", namespace: {} as any } },
		);

		const journal = await logic.getJournal();
		expect(journal.length).toBeGreaterThan(0);
		expect(journal[0].name).toBe("a");
		expect(journal[0].status).toBe("completed");
	});

	it("cancel sets status to cancelled", async () => {
		const storage = createMockStorage();
		const logic = createWorkflowExecutionLogic(storage);

		// Execute to create metadata
		await logic.execute({}, "wf_test", [{ name: "a", type: "step", handler: async () => ({}) }], {
			version: "1.0.0",
			backend: { type: "do", namespace: {} as any },
		});

		// Reset status to running for cancel test
		const meta = await logic.getStatus();
		if (meta) {
			meta.status = "running";
			await storage.put("wf:meta", meta);
		}

		await logic.cancel();
		const updated = await logic.getStatus();
		expect(updated!.status).toBe("cancelled");
	});

	it("runs compensation on failure", async () => {
		const storage = createMockStorage();
		const logic = createWorkflowExecutionLogic(storage);
		const compensationFn = vi.fn();

		await logic.execute(
			{ id: "123" },
			"wf_test",
			[
				{
					name: "ok",
					type: "step",
					handler: async () => ({ done: true }),
				},
				{
					name: "fail",
					type: "step",
					handler: async () => {
						throw new Error("boom");
					},
				},
			],
			{ version: "1.0.0", backend: { type: "do", namespace: {} as any } },
			compensationFn,
		);

		expect(compensationFn).toHaveBeenCalledTimes(1);
		const ctx = compensationFn.mock.calls[0][0];
		expect(ctx.failedStep).toBe("fail");
		expect(ctx.completedSteps).toContain("ok");
	});
});
