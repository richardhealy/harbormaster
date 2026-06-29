import { AuditEntry, TicketId, AgentId } from '../types';
import { randomUUID } from 'crypto';

export class ProvenanceLog {
  private readonly entries: AuditEntry[] = [];

  record(
    event: string,
    data: Record<string, unknown>,
    opts: { ticketId?: TicketId; agentId?: AgentId } = {},
  ): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      event,
      data,
      ticketId: opts.ticketId,
      agentId: opts.agentId,
      timestamp: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  getForTicket(ticketId: TicketId): AuditEntry[] {
    return this.entries.filter((e) => e.ticketId === ticketId);
  }

  getAll(): AuditEntry[] {
    return [...this.entries];
  }
}
