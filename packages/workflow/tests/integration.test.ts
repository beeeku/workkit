import { describe, expect, it, vi } from "vitest";
import { createDurableWorkflow } from "../src/builder";
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

describe("Integration: Full Workflow", () => {
	it("build → execute → complete with step chain", async () => {
		const storage = createMockStorage();
		const logic = createWorkflowExecutionLogic(storage);

		// Build a workflow (validates the builder API works)
		const def = createDurableWorkflow<{ orderId: string }>("order-process", {
			backend: { type: "do", namespace: {} as any },
			version: "1.0.0",
		})
			.step("validate", async (input) => ({
				valid: true,
				orderId: input.orderId,
			}))
			.step("charge", async (input, prev) => ({
				chargeId: `ch_${prev.validate.orderId}`,
			}))
			.step("fulfill", async (input, prev) => ({
				shipped: true,
				chargeId: prev.charge.chargeId,
			}))
			.build();

		// Execute directly via logic (bypassing DO HTTP layer)
		const steps = [
			{
				name: "validate",
				type: "step" as const,
				handler: async (input: any) => ({
					valid: true,
					orderId: input.orderId,
				}),
			},
			{
				name: "charge",
				type: "step" as const,
				handler: async (input: any, prev: any) => ({
					chargeId: `ch_${prev.validate.orderId}`,
				}),
			},
			{
				name: "fulfill",
				type: "step" as const,
				handler: async (input: any, prev: any) => ({
					shipped: true,
					chargeId: prev.charge.chargeId,
				}),
			},
		];

		const result = await logic.execute({ orderId: "ORD-001" }, "wf_order_001", steps, {
			version: "1.0.0",
			backend: { type: "do", namespace: {} as any },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.validate).toEqual({
				valid: true,
				orderId: "ORD-001",
			});
			expect(result.value.charge).toEqual({ chargeId: "ch_ORD-001" });
			expect(result.value.fulfill).toEqual({
				shipped: true,
				chargeId: "ch_ORD-001",
			});
		}
	});

	it("step failure triggers compensation", async () => {
		const storage = createMockStorage();
		const logic = createWorkflowExecutionLogic(storage);
		const compensationFn = vi.fn();

		const steps = [
			{
				name: "charge",
				type: "step" as const,
				handler: async () => ({ chargeId: "ch_123" }),
			},
			{
				name: "ship",
				type: "step" as const,
				handler: async () => {
					throw new Error("out of stock");
				},
			},
		];

		const result = await logic.execute(
			{ orderId: "ORD-002" },
			"wf_order_002",
			steps,
			{ version: "1.0.0", backend: { type: "do", namespace: {} as any } },
			compensationFn,
		);

		expect(result.ok).toBe(false);
		expect(compensationFn).toHaveBeenCalledTimes(1);
		const ctx = compensationFn.mock.calls[0][0];
		expect(ctx.failedStep).toBe("ship");
		expect(ctx.completedSteps).toContain("charge");
		expect(ctx.stepOutputs.charge).toEqual({ chargeId: "ch_123" });
	});

	it("replay skips completed steps", async () => {
		const storage = createMockStorage();
		const logic = createWorkflowExecutionLogic(storage);
		const called: string[] = [];

		const steps = [
			{
				name: "a",
				type: "step" as const,
				handler: async () => {
					called.push("a");
					return { a: 1 };
				},
			},
			{
				name: "b",
				type: "step" as const,
				handler: async () => {
					called.push("b");
					return { b: 2 };
				},
			},
		];

		// First run
		await logic.execute({}, "wf_replay", steps, {
			version: "1.0.0",
			backend: { type: "do", namespace: {} as any },
		});
		expect(called).toEqual(["a", "b"]);

		// Second run on same storage (replay)
		called.length = 0;
		const logic2 = createWorkflowExecutionLogic(storage);
		await logic2.execute({}, "wf_replay", steps, {
			version: "1.0.0",
			backend: { type: "do", namespace: {} as any },
		});

		// Both should be skipped (already completed)
		expect(called).toEqual([]);
	});
});
