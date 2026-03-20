import { describe, expect, it, vi } from "vitest";
import { createStateMachine } from "../src/state-machine";
import { createMockStorage } from "./helpers";

type OrderState = "pending" | "processing" | "shipped" | "delivered" | "cancelled";
type OrderEvent =
	| { type: "start_processing" }
	| { type: "ship"; trackingId: string }
	| { type: "deliver" }
	| { type: "cancel"; reason: string };

const orderConfig = () => ({
	initial: "pending" as const,
	transitions: {
		pending: {
			start_processing: "processing" as const,
			cancel: "cancelled" as const,
		},
		processing: {
			ship: "shipped" as const,
			cancel: "cancelled" as const,
		},
		shipped: {
			deliver: "delivered" as const,
		},
	},
});

describe("createStateMachine", () => {
	describe("initialization", () => {
		it("should start in the initial state", () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			expect(machine.getState()).toBe("pending");
		});

		it("should accept custom initial state", () => {
			const machine = createStateMachine<OrderState, OrderEvent>({
				...orderConfig(),
				initial: "processing",
			});
			expect(machine.getState()).toBe("processing");
		});
	});

	describe("send", () => {
		it("should transition on valid event", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			const result = await machine.send({ type: "start_processing" }, storage);
			expect(result).toBe("processing");
			expect(machine.getState()).toBe("processing");
		});

		it("should transition through multiple states", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			await machine.send({ type: "ship", trackingId: "TRACK123" }, storage);
			await machine.send({ type: "deliver" }, storage);
			expect(machine.getState()).toBe("delivered");
		});

		it("should throw on invalid transition", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			await expect(machine.send({ type: "deliver" }, storage)).rejects.toThrow();
		});

		it("should throw on invalid event from terminal state", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			await machine.send({ type: "ship", trackingId: "T1" }, storage);
			await machine.send({ type: "deliver" }, storage);
			// delivered is terminal — no transitions defined
			await expect(machine.send({ type: "start_processing" }, storage)).rejects.toThrow();
		});

		it("should throw with descriptive error message", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			await expect(machine.send({ type: "ship", trackingId: "T1" }, storage)).rejects.toThrow(
				/pending.*ship/,
			);
		});

		it("should handle cancel from pending", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			const result = await machine.send({ type: "cancel", reason: "changed mind" }, storage);
			expect(result).toBe("cancelled");
		});

		it("should handle cancel from processing", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			const result = await machine.send({ type: "cancel", reason: "out of stock" }, storage);
			expect(result).toBe("cancelled");
		});
	});

	describe("onTransition callback", () => {
		it("should call onTransition when transitioning", async () => {
			const onTransition = vi.fn();
			const machine = createStateMachine<OrderState, OrderEvent>({
				...orderConfig(),
				onTransition,
			});
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			expect(onTransition).toHaveBeenCalledOnce();
			expect(onTransition).toHaveBeenCalledWith(
				"pending",
				"processing",
				{ type: "start_processing" },
				storage,
			);
		});

		it("should call onTransition with event payload", async () => {
			const onTransition = vi.fn();
			const machine = createStateMachine<OrderState, OrderEvent>({
				...orderConfig(),
				onTransition,
			});
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			await machine.send({ type: "ship", trackingId: "TRACK456" }, storage);
			expect(onTransition).toHaveBeenCalledTimes(2);
			expect(onTransition).toHaveBeenLastCalledWith(
				"processing",
				"shipped",
				{ type: "ship", trackingId: "TRACK456" },
				storage,
			);
		});

		it("should not call onTransition on invalid transitions", async () => {
			const onTransition = vi.fn();
			const machine = createStateMachine<OrderState, OrderEvent>({
				...orderConfig(),
				onTransition,
			});
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			onTransition.mockClear();
			await expect(machine.send({ type: "deliver" }, storage)).rejects.toThrow();
			expect(onTransition).not.toHaveBeenCalled();
		});

		it("should await async onTransition", async () => {
			const order: string[] = [];
			const onTransition = vi.fn(async () => {
				await new Promise((r) => setTimeout(r, 10));
				order.push("transition-done");
			});
			const machine = createStateMachine<OrderState, OrderEvent>({
				...orderConfig(),
				onTransition,
			});
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			order.push("after-send");
			expect(order).toEqual(["transition-done", "after-send"]);
		});
	});

	describe("canSend", () => {
		it("should return true for valid event", () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			expect(machine.canSend("start_processing")).toBe(true);
		});

		it("should return false for invalid event", () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			expect(machine.canSend("deliver")).toBe(false);
		});

		it("should update after transition", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			expect(machine.canSend("ship")).toBe(false);
			await machine.send({ type: "start_processing" }, storage);
			expect(machine.canSend("ship")).toBe(true);
		});

		it("should return false for terminal states", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			await machine.send({ type: "ship", trackingId: "T" }, storage);
			await machine.send({ type: "deliver" }, storage);
			expect(machine.canSend("start_processing")).toBe(false);
			expect(machine.canSend("cancel")).toBe(false);
		});
	});

	describe("getValidEvents", () => {
		it("should return valid events for current state", () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const events = machine.getValidEvents();
			expect(events).toContain("start_processing");
			expect(events).toContain("cancel");
			expect(events).not.toContain("ship");
		});

		it("should update after transition", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			const events = machine.getValidEvents();
			expect(events).toContain("ship");
			expect(events).toContain("cancel");
			expect(events).not.toContain("start_processing");
		});

		it("should return empty array for terminal states", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			await machine.send({ type: "ship", trackingId: "T" }, storage);
			await machine.send({ type: "deliver" }, storage);
			expect(machine.getValidEvents()).toEqual([]);
		});
	});

	describe("reset", () => {
		it("should reset to initial state", async () => {
			const machine = createStateMachine<OrderState, OrderEvent>(orderConfig());
			const storage = createMockStorage();
			await machine.send({ type: "start_processing" }, storage);
			machine.reset();
			expect(machine.getState()).toBe("pending");
		});
	});
});
