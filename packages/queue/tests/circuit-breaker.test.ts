import { beforeEach, describe, expect, it, vi } from "vitest";
import { withCircuitBreaker } from "../src/circuit-breaker";
import type { CircuitBreakerState } from "../src/types";
import { createMockKV } from "./helpers/mock-kv";
import { createMockBatch, createMockMessage, resetMessageIdCounter } from "./helpers/mock-queue";

type UserEvent = { type: "created" | "updated"; userId: string };

describe("withCircuitBreaker()", () => {
	beforeEach(() => {
		resetMessageIdCounter();
	});

	it("passes messages through when circuit is closed", async () => {
		const kv = createMockKV();
		const processed: UserEvent[] = [];

		const inner = vi.fn(async (batch: any) => {
			for (const msg of batch.messages) {
				processed.push(msg.body);
				msg.ack();
			}
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
		});

		const messages = [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
			createMockMessage<UserEvent>({ type: "updated", userId: "2" }),
		];
		const batch = createMockBatch("test-queue", messages);

		await handler(batch as any, {} as any);

		expect(inner).toHaveBeenCalledOnce();
		expect(processed).toHaveLength(2);
	});

	it("initializes state as closed on first invocation", async () => {
		const kv = createMockKV();
		const inner = vi.fn(async (batch: any) => {
			for (const msg of batch.messages) msg.ack();
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
		]);

		await handler(batch as any, {} as any);

		const state: CircuitBreakerState = await kv.get("test-circuit", "json");
		expect(state.state).toBe("closed");
		expect(state.failures).toBe(0);
	});

	it("increments failure count when consumer throws", async () => {
		const kv = createMockKV();
		const inner = vi.fn(async () => {
			throw new Error("downstream failure");
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
		]);

		await handler(batch as any, {} as any);

		const state: CircuitBreakerState = await kv.get("test-circuit", "json");
		expect(state.failures).toBe(1);
		expect(state.state).toBe("closed");
	});

	it("opens circuit when failure threshold is reached", async () => {
		const kv = createMockKV();
		const inner = vi.fn(async () => {
			throw new Error("downstream failure");
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
		});

		// Run 3 times to hit threshold
		for (let i = 0; i < 3; i++) {
			resetMessageIdCounter();
			const batch = createMockBatch("test-queue", [
				createMockMessage<UserEvent>({ type: "created", userId: `${i}` }),
			]);
			await handler(batch as any, {} as any);
		}

		const state: CircuitBreakerState = await kv.get("test-circuit", "json");
		expect(state.state).toBe("open");
		expect(state.failures).toBe(3);
		expect(state.openedAt).toBeGreaterThan(0);
	});

	it("retries all messages with delay when circuit is open", async () => {
		const kv = createMockKV();

		// Pre-set state to open
		const openState: CircuitBreakerState = {
			state: "open",
			failures: 3,
			lastFailure: Date.now(),
			openedAt: Date.now(),
			halfOpenAttempts: 0,
		};
		await kv.put("test-circuit", JSON.stringify(openState));

		const inner = vi.fn();

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
		});

		const messages = [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
			createMockMessage<UserEvent>({ type: "updated", userId: "2" }),
		];
		const batch = createMockBatch("test-queue", messages);

		await handler(batch as any, {} as any);

		// Consumer should NOT be called
		expect(inner).not.toHaveBeenCalled();
		// All messages should be retried
		expect(messages[0]._retried).toBe(true);
		expect(messages[1]._retried).toBe(true);
	});

	it("transitions from open to half-open after resetTimeout", async () => {
		const kv = createMockKV();

		// Set state to open, but with openedAt 31 seconds ago
		const openState: CircuitBreakerState = {
			state: "open",
			failures: 3,
			lastFailure: Date.now() - 31_000,
			openedAt: Date.now() - 31_000,
			halfOpenAttempts: 0,
		};
		await kv.put("test-circuit", JSON.stringify(openState));

		const inner = vi.fn(async (batch: any) => {
			for (const msg of batch.messages) msg.ack();
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
		]);

		await handler(batch as any, {} as any);

		// Consumer should be called (half-open allows messages through)
		expect(inner).toHaveBeenCalledOnce();
	});

	it("allows only halfOpenMax messages in half-open state", async () => {
		const kv = createMockKV();

		// Set state to half-open
		const halfOpenState: CircuitBreakerState = {
			state: "half-open",
			failures: 3,
			lastFailure: Date.now() - 31_000,
			openedAt: Date.now() - 31_000,
			halfOpenAttempts: 0,
		};
		await kv.put("test-circuit", JSON.stringify(halfOpenState));

		const processedBodies: UserEvent[] = [];
		const inner = vi.fn(async (batch: any) => {
			for (const msg of batch.messages) {
				processedBodies.push(msg.body);
				msg.ack();
			}
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
			halfOpenMax: 1,
		});

		const messages = [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
			createMockMessage<UserEvent>({ type: "updated", userId: "2" }),
			createMockMessage<UserEvent>({ type: "created", userId: "3" }),
		];
		const batch = createMockBatch("test-queue", messages);

		await handler(batch as any, {} as any);

		// Only 1 message (halfOpenMax) should be passed to inner consumer
		expect(inner).toHaveBeenCalledOnce();
		// Remaining messages should be retried
		expect(messages[1]._retried).toBe(true);
		expect(messages[2]._retried).toBe(true);
	});

	it("closes circuit on success in half-open state", async () => {
		const kv = createMockKV();

		const halfOpenState: CircuitBreakerState = {
			state: "half-open",
			failures: 3,
			lastFailure: Date.now() - 31_000,
			openedAt: Date.now() - 31_000,
			halfOpenAttempts: 0,
		};
		await kv.put("test-circuit", JSON.stringify(halfOpenState));

		const inner = vi.fn(async (batch: any) => {
			for (const msg of batch.messages) msg.ack();
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
			halfOpenMax: 1,
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
		]);

		await handler(batch as any, {} as any);

		const state: CircuitBreakerState = await kv.get("test-circuit", "json");
		expect(state.state).toBe("closed");
		expect(state.failures).toBe(0);
	});

	it("re-opens circuit on failure in half-open state", async () => {
		const kv = createMockKV();

		const halfOpenState: CircuitBreakerState = {
			state: "half-open",
			failures: 3,
			lastFailure: Date.now() - 31_000,
			openedAt: Date.now() - 31_000,
			halfOpenAttempts: 0,
		};
		await kv.put("test-circuit", JSON.stringify(halfOpenState));

		const inner = vi.fn(async () => {
			throw new Error("still failing");
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
			halfOpenMax: 1,
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
		]);

		await handler(batch as any, {} as any);

		const state: CircuitBreakerState = await kv.get("test-circuit", "json");
		expect(state.state).toBe("open");
		expect(state.openedAt).toBeGreaterThan(0);
	});

	it("resets failure count on success in closed state", async () => {
		const kv = createMockKV();

		// Pre-set state with some failures but still closed
		const closedState: CircuitBreakerState = {
			state: "closed",
			failures: 2,
			lastFailure: Date.now() - 5_000,
			openedAt: 0,
			halfOpenAttempts: 0,
		};
		await kv.put("test-circuit", JSON.stringify(closedState));

		const inner = vi.fn(async (batch: any) => {
			for (const msg of batch.messages) msg.ack();
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
		});

		const batch = createMockBatch("test-queue", [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
		]);

		await handler(batch as any, {} as any);

		const state: CircuitBreakerState = await kv.get("test-circuit", "json");
		expect(state.failures).toBe(0);
	});

	it("defaults halfOpenMax to 1", async () => {
		const kv = createMockKV();

		const halfOpenState: CircuitBreakerState = {
			state: "half-open",
			failures: 3,
			lastFailure: Date.now() - 31_000,
			openedAt: Date.now() - 31_000,
			halfOpenAttempts: 0,
		};
		await kv.put("test-circuit", JSON.stringify(halfOpenState));

		const passedMessages: any[] = [];
		const inner = vi.fn(async (batch: any) => {
			for (const msg of batch.messages) {
				passedMessages.push(msg);
				msg.ack();
			}
		});

		const handler = withCircuitBreaker<UserEvent>(inner, {
			namespace: kv,
			key: "test-circuit",
			failureThreshold: 3,
			resetTimeout: "30s",
			// no halfOpenMax — defaults to 1
		});

		const messages = [
			createMockMessage<UserEvent>({ type: "created", userId: "1" }),
			createMockMessage<UserEvent>({ type: "updated", userId: "2" }),
		];
		const batch = createMockBatch("test-queue", messages);

		await handler(batch as any, {} as any);

		// Only 1 message passed through (default halfOpenMax)
		expect(passedMessages).toHaveLength(1);
		expect(messages[1]._retried).toBe(true);
	});
});
