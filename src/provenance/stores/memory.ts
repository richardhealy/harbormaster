import crypto from 'node:crypto'
import type { AuditStore, AuditEvent, AuditLogEntry, AuditQueryOptions } from '../types.js'

type IndexedEntry = AuditLogEntry & { _seq: number }

export class InMemoryAuditStore implements AuditStore {
  private readonly entries: IndexedEntry[] = []
  private seq = 0

  async append(event: AuditEvent): Promise<AuditLogEntry> {
    const entry: IndexedEntry = {
      ...event,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      _seq: this.seq++,
    }
    this.entries.push(entry)
    // Return without the internal _seq field
    const { _seq: _, ...result } = entry
    void _
    return result
  }

  async query(opts: AuditQueryOptions): Promise<AuditLogEntry[]> {
    let results = this.entries.slice()

    if (opts.ticketId !== undefined) {
      results = results.filter(e => e.ticketId === opts.ticketId)
    }
    if (opts.agentId !== undefined) {
      results = results.filter(e => e.agentId === opts.agentId)
    }
    if (opts.eventType !== undefined) {
      results = results.filter(e => e.eventType === opts.eventType)
    }
    if (opts.since !== undefined) {
      const since = opts.since
      results = results.filter(e => e.createdAt >= since)
    }

    // Most-recent first; use insertion sequence as stable tiebreaker
    results.sort((a, b) => {
      const timeDiff = b.createdAt.getTime() - a.createdAt.getTime()
      return timeDiff !== 0 ? timeDiff : b._seq - a._seq
    })

    if (opts.limit !== undefined) {
      results = results.slice(0, opts.limit)
    }

    return results.map(({ _seq: _, ...entry }) => { void _; return entry })
  }
}
