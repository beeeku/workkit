import type { TypedDurableObjectStorage } from "@workkit/types";
import type { BaseEvent } from "./types";

const SEQUENCE_KEY = "__es_sequence";
const SNAPSHOT_KEY = "__es_snapshot";
const SNAPSHOT_AT_KEY = "__es_snapshot_at";
const EVENT_PREFIX = "__es_events_";

/** A stored event with metadata */
export interface StoredEvent<TEvent> {
	id: number;
	event: TEvent;
	timestamp: number;
}

/** Options for creating an event store */
export interface EventStoreOptions<TState, TEvent> {
	initialState: TState;
	reducer: (state: TState, event: TEvent) => TState;
	/** Create a snapshot every N events. Default: 50 */
	snapshotEvery?: number;
}

/** An event store with append, state materialization, and replay */
export interface EventStore<TState, TEvent> {
	append(event: TEvent): Promise<TState>;
	getState(): Promise<TState>;
	getEvents(options?: { after?: number; limit?: number }): Promise<StoredEvent<TEvent>[]>;
	rebuild(): Promise<TState>;
}

function padSequence(seq: number): string {
	return String(seq).padStart(6, "0");
}

function eventKey(seq: number): string {
	return `${EVENT_PREFIX}${padSequence(seq)}`;
}

/**
 * Creates an immutable event log with reducer-based state materialization
 * and periodic snapshots.
 *
 * ```ts
 * const store = createEventStore<OrderState, OrderEvent>(storage, {
 *   initialState: { status: 'pending', items: [] },
 *   reducer: (state, event) => { ... },
 *   snapshotEvery: 50,
 * })
 *
 * await store.append({ type: 'item_added', item: { ... } })
 * const state = await store.getState()
 * ```
 */
export function createEventStore<TState, TEvent extends BaseEvent>(
	storage: TypedDurableObjectStorage,
	options: EventStoreOptions<TState, TEvent>,
): EventStore<TState, TEvent> {
	const { initialState, reducer, snapshotEvery = 50 } = options;

	return {
		async append(event: TEvent): Promise<TState> {
			const currentSeq = (await storage.get<number>(SEQUENCE_KEY)) ?? 0;
			const nextSeq = currentSeq + 1;

			const stored: StoredEvent<TEvent> = {
				id: nextSeq,
				event,
				timestamp: Date.now(),
			};

			await storage.put(eventKey(nextSeq), stored);
			await storage.put(SEQUENCE_KEY, nextSeq);

			// Materialize state
			const state = await materializeState(storage, initialState, reducer);

			// Snapshot if interval hit
			if (nextSeq % snapshotEvery === 0) {
				await storage.put(SNAPSHOT_KEY, state);
				await storage.put(SNAPSHOT_AT_KEY, nextSeq);
			}

			return state;
		},

		async getState(): Promise<TState> {
			const seq = (await storage.get<number>(SEQUENCE_KEY)) ?? 0;
			if (seq === 0) return initialState;

			return materializeState(storage, initialState, reducer);
		},

		async getEvents(opts?: { after?: number; limit?: number }): Promise<StoredEvent<TEvent>[]> {
			const after = opts?.after ?? 0;
			const limit = opts?.limit;

			// Use startAfter for pagination
			const listOpts: { prefix: string; startAfter?: string; limit?: number } = {
				prefix: EVENT_PREFIX,
			};

			if (after > 0) {
				listOpts.startAfter = eventKey(after);
			}

			if (limit !== undefined) {
				listOpts.limit = limit;
			}

			const entries = await storage.list<StoredEvent<TEvent>>(listOpts);
			const events: StoredEvent<TEvent>[] = [];

			for (const [, value] of entries) {
				events.push(value);
			}

			return events;
		},

		async rebuild(): Promise<TState> {
			// Clear snapshot
			await storage.delete(SNAPSHOT_KEY);
			await storage.delete(SNAPSHOT_AT_KEY);

			const seq = (await storage.get<number>(SEQUENCE_KEY)) ?? 0;
			if (seq === 0) return initialState;

			// Replay all events from scratch
			const entries = await storage.list<StoredEvent<TEvent>>({ prefix: EVENT_PREFIX });
			let state = initialState;
			for (const [, stored] of entries) {
				state = reducer(state, stored.event);
			}

			return state;
		},
	};
}

async function materializeState<TState, TEvent extends BaseEvent>(
	storage: TypedDurableObjectStorage,
	initialState: TState,
	reducer: (state: TState, event: TEvent) => TState,
): Promise<TState> {
	const snapshotAt = await storage.get<number>(SNAPSHOT_AT_KEY);
	let state: TState;
	let startAfter: string | undefined;

	if (snapshotAt !== undefined) {
		state = (await storage.get<TState>(SNAPSHOT_KEY)) ?? initialState;
		startAfter = eventKey(snapshotAt);
	} else {
		state = initialState;
		startAfter = undefined;
	}

	const listOpts: { prefix: string; startAfter?: string } = { prefix: EVENT_PREFIX };
	if (startAfter) {
		listOpts.startAfter = startAfter;
	}

	const entries = await storage.list<StoredEvent<TEvent>>(listOpts);
	for (const [, stored] of entries) {
		state = reducer(state, stored.event);
	}

	return state;
}
