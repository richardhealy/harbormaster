import { describe, it, expect, beforeEach } from 'vitest'
import { AuditLogger, createAuditLogger, InMemoryAuditStore } from '../../src/provenance/index.js'
import type { AuditEvent } from '../../src/provenance/types.js'

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventType: 'dispatch.created',
    payload: { branch: 'feat/ENG-1/fix' },
    ticketId: 'ENG-1',
    agentId: 'agent-001',
    actor: 'conductor',
    ...overrides,
  }
}

describe('InMemoryAuditStore', () => {
  it('appends an entry and assigns an id and createdAt', async () => {
    const store = new InMemoryAuditStore()
    const entry = await store.append(makeEvent())

    expect(entry.id).toBeTruthy()
    expect(entry.createdAt).toBeInstanceOf(Date)
    expect(entry.eventType).toBe('dispatch.created')
  })

  it('assigns unique ids to successive entries', async () => {
    const store = new InMemoryAuditStore()
    const a = await store.append(makeEvent())
    const b = await store.append(makeEvent())
    expect(a.id).not.toBe(b.id)
  })

  it('entries are immutable after append — modifying the original event does not affect the log', async () => {
    const store = new InMemoryAuditStore()
    const ev = makeEvent()
    await store.append(ev)
    ev.actor = 'tampered'
    const results = await store.query({})
    expect(results[0].actor).toBe('conductor')
  })
})

describe('AuditLogger', () => {
  let logger: AuditLogger

  beforeEach(() => {
    logger = createAuditLogger()
  })

  it('logs a dispatch.created event', async () => {
    const entry = await logger.log(makeEvent())
    expect(entry.id).toBeTruthy()
    expect(entry.eventType).toBe('dispatch.created')
  })

  it('logs a gate.passed event', async () => {
    const entry = await logger.log(makeEvent({ eventType: 'gate.passed', payload: { gate: 'ci' } }))
    expect(entry.eventType).toBe('gate.passed')
  })

  it('logs a merge.success event', async () => {
    const entry = await logger.log(makeEvent({ eventType: 'merge.success', payload: { pr: 42 } }))
    expect(entry.eventType).toBe('merge.success')
  })

  describe('getByTicket', () => {
    it('returns only entries for the given ticket', async () => {
      await logger.log(makeEvent({ ticketId: 'ENG-1' }))
      await logger.log(makeEvent({ ticketId: 'ENG-2' }))
      await logger.log(makeEvent({ ticketId: 'ENG-1', eventType: 'dispatch.complete' }))

      const results = await logger.getByTicket('ENG-1')
      expect(results).toHaveLength(2)
      expect(results.every(e => e.ticketId === 'ENG-1')).toBe(true)
    })

    it('returns an empty array when no events match', async () => {
      await logger.log(makeEvent({ ticketId: 'ENG-1' }))
      const results = await logger.getByTicket('ENG-999')
      expect(results).toHaveLength(0)
    })

    it('respects the limit parameter', async () => {
      await logger.log(makeEvent({ ticketId: 'ENG-1' }))
      await logger.log(makeEvent({ ticketId: 'ENG-1' }))
      await logger.log(makeEvent({ ticketId: 'ENG-1' }))

      const results = await logger.getByTicket('ENG-1', 2)
      expect(results).toHaveLength(2)
    })
  })

  describe('getByAgent', () => {
    it('returns only entries for the given agent', async () => {
      await logger.log(makeEvent({ agentId: 'agent-001' }))
      await logger.log(makeEvent({ agentId: 'agent-002' }))
      await logger.log(makeEvent({ agentId: 'agent-001', eventType: 'dispatch.complete' }))

      const results = await logger.getByAgent('agent-001')
      expect(results).toHaveLength(2)
    })

    it('returns an empty array for an unknown agent', async () => {
      const results = await logger.getByAgent('unknown-agent')
      expect(results).toHaveLength(0)
    })
  })

  describe('getByEventType', () => {
    it('returns only entries of the given event type', async () => {
      await logger.log(makeEvent({ eventType: 'dispatch.created' }))
      await logger.log(makeEvent({ eventType: 'dispatch.complete' }))
      await logger.log(makeEvent({ eventType: 'dispatch.created' }))
      await logger.log(makeEvent({ eventType: 'gate.passed' }))

      const results = await logger.getByEventType('dispatch.created')
      expect(results).toHaveLength(2)
    })
  })

  describe('getRecent', () => {
    it('returns the most recent entries first', async () => {
      await logger.log(makeEvent({ payload: { seq: 1 } }))
      await logger.log(makeEvent({ payload: { seq: 2 } }))
      await logger.log(makeEvent({ payload: { seq: 3 } }))

      const results = await logger.getRecent(10)
      expect(results).toHaveLength(3)
      // most recent first
      expect(results[0].payload.seq).toBe(3)
      expect(results[2].payload.seq).toBe(1)
    })

    it('limits to the given count', async () => {
      for (let i = 0; i < 10; i++) {
        await logger.log(makeEvent({ payload: { i } }))
      }
      const results = await logger.getRecent(3)
      expect(results).toHaveLength(3)
    })

    it('defaults to 50', async () => {
      for (let i = 0; i < 60; i++) {
        await logger.log(makeEvent())
      }
      const results = await logger.getRecent()
      expect(results).toHaveLength(50)
    })
  })

  describe('query (combined filters)', () => {
    it('filters by both ticketId and eventType', async () => {
      await logger.log(makeEvent({ ticketId: 'ENG-1', eventType: 'dispatch.created' }))
      await logger.log(makeEvent({ ticketId: 'ENG-1', eventType: 'dispatch.complete' }))
      await logger.log(makeEvent({ ticketId: 'ENG-2', eventType: 'dispatch.created' }))

      const results = await logger.query({ ticketId: 'ENG-1', eventType: 'dispatch.created' })
      expect(results).toHaveLength(1)
      expect(results[0].eventType).toBe('dispatch.created')
      expect(results[0].ticketId).toBe('ENG-1')
    })

    it('filters by since', async () => {
      const before = new Date(Date.now() - 5000)
      await logger.log(makeEvent({ payload: { order: 1 } }))
      const after = new Date()
      await logger.log(makeEvent({ payload: { order: 2 } }))

      const results = await logger.query({ since: after })
      expect(results.every(e => e.createdAt >= after)).toBe(true)
      // The entry logged before `after` may or may not be included depending on
      // exact timing, so just assert all returned are within the since window.
      const beforeResults = await logger.query({ since: before })
      expect(beforeResults.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('all supported event types', () => {
    const ALL_TYPES = [
      'ticket.synced',
      'dispatch.created',
      'dispatch.complete',
      'dispatch.failed',
      'dispatch.cancelled',
      'gate.passed',
      'gate.failed',
      'gate.skipped',
      'merge.success',
      'merge.failure',
      'rerun.dispatched',
      'release.created',
      'release.frozen',
      'release.released',
      'hotspot.acquired',
      'hotspot.released',
    ] as const

    it.each(ALL_TYPES)('can log and retrieve event type: %s', async (eventType) => {
      await logger.log(makeEvent({ eventType }))
      const results = await logger.getByEventType(eventType)
      expect(results).toHaveLength(1)
      expect(results[0].eventType).toBe(eventType)
    })
  })
})
