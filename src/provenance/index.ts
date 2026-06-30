import type { AuditStore, AuditEvent, AuditLogEntry, AuditEventType, AuditQueryOptions } from './types.js'
import { InMemoryAuditStore } from './stores/memory.js'

export type { AuditStore, AuditEvent, AuditLogEntry, AuditEventType, AuditQueryOptions } from './types.js'
export { InMemoryAuditStore } from './stores/memory.js'
export { PostgresAuditStore } from './stores/postgres.js'

/** Append-only audit logger. The store is injectable so the same class works in tests (memory) and production (Postgres). */
export class AuditLogger {
  constructor(private readonly store: AuditStore) {}

  async log(event: AuditEvent): Promise<AuditLogEntry> {
    return this.store.append(event)
  }

  async getByTicket(ticketId: string, limit?: number): Promise<AuditLogEntry[]> {
    return this.store.query({ ticketId, limit })
  }

  async getByAgent(agentId: string, limit?: number): Promise<AuditLogEntry[]> {
    return this.store.query({ agentId, limit })
  }

  async getByEventType(eventType: AuditEventType, limit?: number): Promise<AuditLogEntry[]> {
    return this.store.query({ eventType, limit })
  }

  async getRecent(limit = 50): Promise<AuditLogEntry[]> {
    return this.store.query({ limit })
  }

  async query(opts: AuditQueryOptions): Promise<AuditLogEntry[]> {
    return this.store.query(opts)
  }
}

export function createAuditLogger(store?: AuditStore): AuditLogger {
  return new AuditLogger(store ?? new InMemoryAuditStore())
}
