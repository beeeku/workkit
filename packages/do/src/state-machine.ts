import type { TypedDurableObjectStorage } from '@workkit/types'
import { ValidationError } from '@workkit/errors'
import type { BaseEvent, StateMachineConfig, StateMachine } from './types'

/**
 * Creates a finite state machine that integrates with Durable Object storage.
 *
 * ```ts
 * const machine = createStateMachine<OrderState, OrderEvent>({
 *   initial: 'pending',
 *   transitions: {
 *     pending: { start_processing: 'processing', cancel: 'cancelled' },
 *     processing: { ship: 'shipped', cancel: 'cancelled' },
 *     shipped: { deliver: 'delivered' },
 *   },
 *   onTransition: async (from, to, event, storage) => {
 *     await storage.put('state', to)
 *   },
 * })
 * ```
 */
export function createStateMachine<
	TState extends string,
	TEvent extends BaseEvent,
>(config: StateMachineConfig<TState, TEvent>): StateMachine<TState, TEvent> {
	let current: TState = config.initial

	return {
		getState(): TState {
			return current
		},

		async send(event: TEvent, storage: TypedDurableObjectStorage): Promise<TState> {
			const stateTransitions = config.transitions[current] as
				| Partial<Record<string, TState>>
				| undefined

			if (!stateTransitions) {
				throw new ValidationError(
					`No transitions defined for state "${current}". Cannot handle event "${event.type}".`,
					[{ path: ['state'], message: `No transitions defined for state "${current}"` }],
				)
			}

			const nextState = stateTransitions[event.type]
			if (nextState === undefined) {
				const validEvents = Object.keys(stateTransitions)
				throw new ValidationError(
					`Invalid transition: state "${current}" does not handle event "${event.type}". ` +
						`Valid events: [${validEvents.join(', ')}]`,
					[{ path: ['event', 'type'], message: `Invalid event "${event.type}" for state "${current}". Valid events: [${validEvents.join(', ')}]` }],
				)
			}

			const from = current
			current = nextState

			if (config.onTransition) {
				await config.onTransition(from, nextState, event, storage)
			}

			return current
		},

		canSend(eventType: TEvent['type']): boolean {
			const stateTransitions = config.transitions[current] as
				| Partial<Record<string, TState>>
				| undefined
			if (!stateTransitions) return false
			return eventType in stateTransitions
		},

		getValidEvents(): string[] {
			const stateTransitions = config.transitions[current] as
				| Partial<Record<string, TState>>
				| undefined
			if (!stateTransitions) return []
			return Object.keys(stateTransitions)
		},

		reset(): void {
			current = config.initial
		},
	}
}
