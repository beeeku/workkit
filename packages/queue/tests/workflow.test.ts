import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkflow } from "../src/workflow";
import { createMockBatch, createMockMessage, resetMessageIdCounter } from "./helpers/mock-queue";

type OrderEvent = { orderId: string; amount: number };

describe("createWorkflow()", () => {
	beforeEach(() => {
		resetMessageIdCounter();
	});

	it("executes all steps in sequence for each message", async () => {
		const stepOrder: string[] = [];

		const handler = createWorkflow<OrderEvent>({
			steps: [
				{
					name: "validate",
					async process(body) {
						stepOrder.push(`validate:${body.orderId}`);
						return { validated: true };
					},
				},
				{
					name: "charge",
					async process(body) {
						stepOrder.push(`charge:${body.orderId}`);
						return { charged: true };
					},
				},
				{
					name: "fulfill",
					async process(body) {
						stepOrder.push(`fulfill:${body.orderId}`);
						return { fulfilled: true };
					},
				},
			],
		});

		const messages = [createMockMessage<OrderEvent>({ orderId: "A", amount: 100 })];
		const batch = createMockBatch("test-queue", messages);

		await handler(batch as any, {} as any);

		expect(stepOrder).toEqual(["validate:A", "charge:A", "fulfill:A"]);
		expect(messages[0]._acked).toBe(true);
	});

	it("merges context forward through steps", async () => {
		const contextSeen: Record<string, unknown>[] = [];

		const handler = createWorkflow<OrderEvent, { validated?: boolean; charged?: boolean }>({
			steps: [
				{
					name: "validate",
					async process(_body, ctx) {
						contextSeen.push({ ...ctx });
						return { validated: true };
					},
				},
				{
					name: "charge",
					async process(_body, ctx) {
						contextSeen.push({ ...ctx });
						return { charged: true };
					},
				},
				{
					name: "confirm",
					async process(_body, ctx) {
						contextSeen.push({ ...ctx });
						return {};
					},
				},
			],
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<OrderEvent>({ orderId: "A", amount: 100 }),
		]);

		await handler(batch as any, {} as any);

		// Step 1 sees empty context
		expect(contextSeen[0]).toEqual({});
		// Step 2 sees validate's output
		expect(contextSeen[1]).toEqual({ validated: true });
		// Step 3 sees both
		expect(contextSeen[2]).toEqual({ validated: true, charged: true });
	});

	it("calls onComplete with final context", async () => {
		const completions: { body: OrderEvent; ctx: Record<string, unknown> }[] = [];

		const handler = createWorkflow<OrderEvent, { total?: number }>({
			steps: [
				{
					name: "calculate",
					async process(body) {
						return { total: body.amount * 1.1 };
					},
				},
			],
			async onComplete(body, ctx) {
				completions.push({ body, ctx: { ...ctx } });
			},
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<OrderEvent>({ orderId: "A", amount: 100 }),
		]);

		await handler(batch as any, {} as any);

		expect(completions).toHaveLength(1);
		expect(completions[0].body).toEqual({ orderId: "A", amount: 100 });
		expect(completions[0].ctx.total).toBeCloseTo(110);
	});

	it("triggers rollback of completed steps on failure (reverse order)", async () => {
		const rollbackOrder: string[] = [];

		const handler = createWorkflow<OrderEvent>({
			steps: [
				{
					name: "reserve",
					async process() {
						return { reserved: true };
					},
					async rollback(_body, _ctx) {
						rollbackOrder.push("reserve");
					},
				},
				{
					name: "charge",
					async process() {
						return { charged: true };
					},
					async rollback(_body, _ctx) {
						rollbackOrder.push("charge");
					},
				},
				{
					name: "ship",
					async process() {
						throw new Error("shipping service down");
					},
					async rollback(_body, _ctx) {
						rollbackOrder.push("ship");
					},
				},
			],
		});

		const messages = [createMockMessage<OrderEvent>({ orderId: "A", amount: 100 })];
		const batch = createMockBatch("test-queue", messages);

		await handler(batch as any, {} as any);

		// Only completed steps rolled back in reverse order (ship didn't complete)
		expect(rollbackOrder).toEqual(["charge", "reserve"]);
		// Message should be retried on failure
		expect(messages[0]._retried).toBe(true);
	});

	it("calls onError when a step fails", async () => {
		const errors: { error: unknown; stepName: string; body: OrderEvent }[] = [];

		const handler = createWorkflow<OrderEvent>({
			steps: [
				{
					name: "validate",
					async process() {
						return {};
					},
				},
				{
					name: "charge",
					async process() {
						throw new Error("payment failed");
					},
				},
			],
			async onError(error, stepName, body) {
				errors.push({ error, stepName, body });
			},
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<OrderEvent>({ orderId: "A", amount: 100 }),
		]);

		await handler(batch as any, {} as any);

		expect(errors).toHaveLength(1);
		expect(errors[0].stepName).toBe("charge");
		expect(errors[0].body).toEqual({ orderId: "A", amount: 100 });
		expect(errors[0].error).toBeInstanceOf(Error);
	});

	it("handles single-step degenerate case", async () => {
		const processed: OrderEvent[] = [];

		const handler = createWorkflow<OrderEvent>({
			steps: [
				{
					name: "process",
					async process(body) {
						processed.push(body);
						return {};
					},
				},
			],
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<OrderEvent>({ orderId: "A", amount: 50 }),
		]);

		await handler(batch as any, {} as any);

		expect(processed).toEqual([{ orderId: "A", amount: 50 }]);
	});

	it("processes multiple messages independently", async () => {
		const completed: string[] = [];

		const handler = createWorkflow<OrderEvent>({
			steps: [
				{
					name: "validate",
					async process(body) {
						return { valid: body.amount > 0 };
					},
				},
			],
			async onComplete(body) {
				completed.push(body.orderId);
			},
		});

		const messages = [
			createMockMessage<OrderEvent>({ orderId: "A", amount: 100 }),
			createMockMessage<OrderEvent>({ orderId: "B", amount: 200 }),
		];
		const batch = createMockBatch("test-queue", messages);

		await handler(batch as any, {} as any);

		expect(completed).toEqual(["A", "B"]);
		expect(messages[0]._acked).toBe(true);
		expect(messages[1]._acked).toBe(true);
	});

	it("retries message when step fails and does not ack", async () => {
		let callCount = 0;

		const handler = createWorkflow<OrderEvent>({
			steps: [
				{
					name: "flaky",
					async process() {
						callCount++;
						if (callCount === 1) throw new Error("transient");
						return {};
					},
				},
			],
		});

		const msg = createMockMessage<OrderEvent>({ orderId: "A", amount: 100 });
		const batch = createMockBatch("test-queue", [msg]);

		await handler(batch as any, {} as any);

		// First call fails — message retried
		expect(msg._retried).toBe(true);
		expect(msg._acked).toBe(false);
	});

	it("handles empty batch gracefully", async () => {
		const handler = createWorkflow<OrderEvent>({
			steps: [
				{
					name: "noop",
					async process() {
						return {};
					},
				},
			],
		});

		const batch = createMockBatch<OrderEvent>("test-queue", []);
		await handler(batch as any, {} as any);
		// No error thrown
	});

	it("skips rollback for steps without rollback function", async () => {
		const rollbackOrder: string[] = [];

		const handler = createWorkflow<OrderEvent>({
			steps: [
				{
					name: "step1",
					async process() {
						return {};
					},
					// No rollback
				},
				{
					name: "step2",
					async process() {
						return {};
					},
					async rollback() {
						rollbackOrder.push("step2");
					},
				},
				{
					name: "step3",
					async process() {
						throw new Error("fail");
					},
				},
			],
		});

		const msg = createMockMessage<OrderEvent>({ orderId: "A", amount: 100 });
		const batch = createMockBatch("test-queue", [msg]);

		await handler(batch as any, {} as any);

		// Only step2 has rollback defined
		expect(rollbackOrder).toEqual(["step2"]);
	});
});
