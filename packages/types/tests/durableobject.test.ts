import { describe, it, expectTypeOf } from 'vitest'
import type {
  StateDefinition,
  MachineState,
  AlarmConfig,
  AlarmResult,
  WSMessage,
  HibernatableWSHandlers,
} from '../src/durableobject'

describe('durableobject types', () => {
  describe('StateDefinition', () => {
    it('enforces transition map types', () => {
      type OrderStates = 'pending' | 'confirmed' | 'shipped' | 'delivered'
      type OrderEvents = 'confirm' | 'ship' | 'deliver'
      type OrderContext = { orderId: string; total: number }

      type Def = StateDefinition<OrderStates, OrderEvents, OrderContext>
      expectTypeOf<Def['states']>().toMatchTypeOf<readonly OrderStates[]>()
      expectTypeOf<Def['initial']>().toMatchTypeOf<OrderStates>()
      expectTypeOf<Def['context']>().toMatchTypeOf<OrderContext>()
    })
  })

  describe('MachineState', () => {
    it('tracks current state and context', () => {
      type State = MachineState<'idle' | 'running', { count: number }>
      expectTypeOf<State['current']>().toMatchTypeOf<'idle' | 'running'>()
      expectTypeOf<State['context']>().toMatchTypeOf<{ count: number }>()
      expectTypeOf<State['updatedAt']>().toBeNumber()
    })
  })

  describe('AlarmConfig', () => {
    it('accepts number or Date for scheduledTime', () => {
      const config1: AlarmConfig = { scheduledTime: Date.now() }
      const config2: AlarmConfig = { scheduledTime: new Date() }
      expectTypeOf(config1).toMatchTypeOf<AlarmConfig>()
      expectTypeOf(config2).toMatchTypeOf<AlarmConfig>()
    })

    it('retry is optional', () => {
      const config: AlarmConfig = { scheduledTime: 0 }
      expectTypeOf(config).toMatchTypeOf<AlarmConfig>()
    })
  })

  describe('AlarmResult', () => {
    it('has success and optional reschedule', () => {
      const result: AlarmResult = { success: true }
      expectTypeOf(result).toMatchTypeOf<AlarmResult>()

      const failed: AlarmResult = {
        success: false,
        reschedule: { scheduledTime: Date.now() + 60000 },
      }
      expectTypeOf(failed).toMatchTypeOf<AlarmResult>()
    })
  })

  describe('WSMessage', () => {
    it('discriminates on type', () => {
      const textMsg: WSMessage<unknown> = { type: 'text', data: 'hello' }
      const binaryMsg: WSMessage<unknown> = { type: 'binary', data: new ArrayBuffer(0) }
      const jsonMsg: WSMessage<{ count: number }> = { type: 'json', data: { count: 1 } }

      expectTypeOf(textMsg).toMatchTypeOf<WSMessage<unknown>>()
      expectTypeOf(binaryMsg).toMatchTypeOf<WSMessage<unknown>>()
      expectTypeOf(jsonMsg).toMatchTypeOf<WSMessage<{ count: number }>>()
    })
  })

  describe('HibernatableWSHandlers', () => {
    it('all handlers are optional', () => {
      const handlers: HibernatableWSHandlers = {}
      expectTypeOf(handlers).toMatchTypeOf<HibernatableWSHandlers>()
    })
  })
})
