import type { TypedDurableObjectStorage } from "@workkit/types";

// --- Typed Storage ---

/** A storage wrapper that enforces a schema on keys and values */
export interface TypedStorageWrapper<TSchema extends Record<string, unknown>> {
	get<K extends keyof TSchema & string>(key: K): Promise<TSchema[K] | undefined>;
	put<K extends keyof TSchema & string>(key: K, value: TSchema[K]): Promise<void>;
	delete<K extends keyof TSchema & string>(key: K): Promise<boolean>;
	list(): Promise<Map<string, unknown>>;
	transaction<R>(closure: (txn: TypedStorageWrapper<TSchema>) => Promise<R>): Promise<R>;
}

// --- State Machine ---

/** Event with a type discriminator and optional payload */
export type BaseEvent = { type: string };

/** Transition map: for each state, what events lead to what next states */
export type TransitionMap<TState extends string, TEvent extends BaseEvent> = Partial<
	Record<TState, Partial<Record<TEvent["type"], TState>>>
>;

/** Options for creating a state machine */
export interface StateMachineConfig<TState extends string, TEvent extends BaseEvent> {
	initial: TState;
	transitions: TransitionMap<TState, TEvent>;
	onTransition?: (
		from: TState,
		to: TState,
		event: TEvent,
		storage: TypedDurableObjectStorage,
	) => Promise<void>;
}

/** A state machine instance */
export interface StateMachine<TState extends string, TEvent extends BaseEvent> {
	/** Get the current state */
	getState(): TState;
	/** Send an event to transition the machine */
	send(event: TEvent, storage: TypedDurableObjectStorage): Promise<TState>;
	/** Check if an event can be sent from the current state */
	canSend(eventType: TEvent["type"]): boolean;
	/** Get valid event types for the current state */
	getValidEvents(): string[];
	/** Reset to initial state */
	reset(): void;
}

// --- Alarms ---

/** Duration specification for scheduling alarms */
export type AlarmSchedule = { in: string; at?: never } | { at: Date | number; in?: never };

/** Alarm action handler */
export type AlarmAction = (storage: TypedDurableObjectStorage) => Promise<void>;

/** Alarm handler config */
export interface AlarmHandlerConfig {
	actions: Record<string, AlarmAction>;
	/** Key in storage where the current action is stored. Defaults to '__alarm_action' */
	actionKey?: string;
}

/** Alarm handler instance */
export interface AlarmHandler {
	handle(storage: TypedDurableObjectStorage): Promise<void>;
}

// --- DO Client ---

/** A typed RPC client for a Durable Object */
export type DOClient<T> = {
	[K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : never;
};

/** Minimal DurableObjectNamespace interface for compatibility */
export interface MinimalDONamespace {
	idFromName(name: string): DurableObjectId;
	get(id: DurableObjectId): DurableObjectStub;
}

/** Minimal DurableObjectId interface */
export interface MinimalDOId {
	toString(): string;
}

/** Minimal DurableObjectStub interface */
export interface MinimalDOStub {
	fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}
