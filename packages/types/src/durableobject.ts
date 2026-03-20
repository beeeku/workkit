import type { TypedDurableObjectStorage } from './bindings'
import type { MaybePromise } from './common'

// --- State machine pattern ---

/** A state definition for DO state machines */
export interface StateDefinition<
	States extends string,
	Events extends string,
	Context extends Record<string, unknown> = Record<string, unknown>,
> {
	/** All valid states */
	states: readonly States[]
	/** Initial state */
	initial: States
	/** Transitions: [currentState, event] -> nextState */
	transitions: Record<States, Partial<Record<Events, States>>>
	/** Context type for storing data alongside state */
	context: Context
}

/** Current state of a DO state machine */
export interface MachineState<
	States extends string,
	Context extends Record<string, unknown> = Record<string, unknown>,
> {
	current: States
	context: Context
	updatedAt: number
}

// --- Alarm pattern ---

/** Alarm configuration */
export interface AlarmConfig {
	/** When to fire (absolute timestamp or relative ms) */
	scheduledTime: number | Date
	/** Retry configuration */
	retry?: {
		maxAttempts: number
		backoffMs: number
	}
}

/** Alarm handler result */
export interface AlarmResult {
	/** Whether the alarm was handled successfully */
	success: boolean
	/** If failed, optional next alarm to schedule */
	reschedule?: AlarmConfig
}

// --- WebSocket hibernation pattern ---

/** Typed WebSocket message */
export type WSMessage<T> =
	| { type: 'text'; data: string }
	| { type: 'binary'; data: ArrayBuffer }
	| { type: 'json'; data: T }

/** WebSocket event handlers for hibernatable DOs */
export interface HibernatableWSHandlers<T = unknown> {
	onMessage?(ws: WebSocket, message: WSMessage<T>): MaybePromise<void>
	onClose?(ws: WebSocket, code: number, reason: string, wasClean: boolean): MaybePromise<void>
	onError?(ws: WebSocket, error: unknown): MaybePromise<void>
}
