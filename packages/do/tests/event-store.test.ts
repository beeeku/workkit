import { describe, expect, it } from "vitest";
import type { BaseEvent } from "../src/types";
import { createEventStore } from "../src/event-store";
import type { EventStore, StoredEvent } from "../src/event-store";
import { createMockStorage } from "./helpers";

// Test domain
interface CounterState {
	count: number;
}

type CounterEvent = { type: "increment"; amount: number } | { type: "decrement"; amount: number };

const counterReducer = (state: CounterState, event: CounterEvent): CounterState => {
	switch (event.type) {
		case "increment":
			return { count: state.count + event.amount };
		case "decrement":
			return { count: state.count - event.amount };
		default:
			return state;
	}
};

const initialState: CounterState = { count: 0 };

describe("createEventStore", () => {
	it("should return initialState for empty store", async () => {
		const raw = createMockStorage();
		const store = createEventStore<CounterState, CounterEvent>(raw, {
			initialState,
			reducer: counterReducer,
		});

		const state = await store.getState();
		expect(state).toEqual({ count: 0 });
	});

	it("should append event and reflect change in state", async () => {
		const raw = createMockStorage();
		const store = createEventStore<CounterState, CounterEvent>(raw, {
			initialState,
			reducer: counterReducer,
		});

		const state = await store.append({ type: "increment", amount: 5 });
		expect(state).toEqual({ count: 5 });
	});

	it("should accumulate multiple events via reducer", async () => {
		const raw = createMockStorage();
		const store = createEventStore<CounterState, CounterEvent>(raw, {
			initialState,
			reducer: counterReducer,
		});

		await store.append({ type: "increment", amount: 10 });
		await store.append({ type: "increment", amount: 3 });
		await store.append({ type: "decrement", amount: 2 });

		const state = await store.getState();
		expect(state).toEqual({ count: 11 });
	});

	it("should create snapshot at configured interval", async () => {
		const raw = createMockStorage();
		const store = createEventStore<CounterState, CounterEvent>(raw, {
			initialState,
			reducer: counterReducer,
			snapshotEvery: 3,
		});

		await store.append({ type: "increment", amount: 1 });
		await store.append({ type: "increment", amount: 2 });

		// No snapshot yet
		expect(raw._data.get("__es_snapshot")).toBeUndefined();

		await store.append({ type: "increment", amount: 3 });

		// Snapshot should exist at sequence 3
		expect(raw._data.get("__es_snapshot")).toEqual({ count: 6 });
		expect(raw._data.get("__es_snapshot_at")).toBe(3);
	});

	it("should getState correctly from snapshot + replay", async () => {
		const raw = createMockStorage();
		const store = createEventStore<CounterState, CounterEvent>(raw, {
			initialState,
			reducer: counterReducer,
			snapshotEvery: 3,
		});

		// Append 3 events (triggers snapshot) + 1 more
		await store.append({ type: "increment", amount: 1 });
		await store.append({ type: "increment", amount: 2 });
		await store.append({ type: "increment", amount: 3 });
		await store.append({ type: "increment", amount: 4 });

		const state = await store.getState();
		expect(state).toEqual({ count: 10 });
	});

	describe("getEvents", () => {
		it("should return all events", async () => {
			const raw = createMockStorage();
			const store = createEventStore<CounterState, CounterEvent>(raw, {
				initialState,
				reducer: counterReducer,
			});

			await store.append({ type: "increment", amount: 1 });
			await store.append({ type: "increment", amount: 2 });
			await store.append({ type: "decrement", amount: 3 });

			const events = await store.getEvents();
			expect(events).toHaveLength(3);
			expect(events[0]!.id).toBe(1);
			expect(events[0]!.event.type).toBe("increment");
			expect(events[1]!.id).toBe(2);
			expect(events[2]!.id).toBe(3);
			expect(events[2]!.event.type).toBe("decrement");
		});

		it("should support after pagination", async () => {
			const raw = createMockStorage();
			const store = createEventStore<CounterState, CounterEvent>(raw, {
				initialState,
				reducer: counterReducer,
			});

			await store.append({ type: "increment", amount: 1 });
			await store.append({ type: "increment", amount: 2 });
			await store.append({ type: "increment", amount: 3 });

			const events = await store.getEvents({ after: 1 });
			expect(events).toHaveLength(2);
			expect(events[0]!.id).toBe(2);
			expect(events[1]!.id).toBe(3);
		});

		it("should support limit pagination", async () => {
			const raw = createMockStorage();
			const store = createEventStore<CounterState, CounterEvent>(raw, {
				initialState,
				reducer: counterReducer,
			});

			await store.append({ type: "increment", amount: 1 });
			await store.append({ type: "increment", amount: 2 });
			await store.append({ type: "increment", amount: 3 });

			const events = await store.getEvents({ limit: 2 });
			expect(events).toHaveLength(2);
			expect(events[0]!.id).toBe(1);
			expect(events[1]!.id).toBe(2);
		});
	});

	it("should have timestamps on stored events", async () => {
		const raw = createMockStorage();
		const store = createEventStore<CounterState, CounterEvent>(raw, {
			initialState,
			reducer: counterReducer,
		});

		const before = Date.now();
		await store.append({ type: "increment", amount: 1 });
		const after = Date.now();

		const events = await store.getEvents();
		expect(events[0]!.timestamp).toBeGreaterThanOrEqual(before);
		expect(events[0]!.timestamp).toBeLessThanOrEqual(after);
	});

	it("should rebuild by replaying all events", async () => {
		const raw = createMockStorage();
		const store = createEventStore<CounterState, CounterEvent>(raw, {
			initialState,
			reducer: counterReducer,
			snapshotEvery: 2,
		});

		await store.append({ type: "increment", amount: 10 });
		await store.append({ type: "increment", amount: 20 });
		await store.append({ type: "decrement", amount: 5 });

		// Snapshot exists at seq 2 with count=30
		expect(raw._data.get("__es_snapshot")).toEqual({ count: 30 });

		const state = await store.rebuild();
		expect(state).toEqual({ count: 25 });

		// Snapshot should be cleared after rebuild
		expect(raw._data.get("__es_snapshot")).toBeUndefined();
		expect(raw._data.get("__es_snapshot_at")).toBeUndefined();
	});
});
