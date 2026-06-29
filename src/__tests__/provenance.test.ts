import { describe, it, expect, beforeEach } from 'vitest';
import { ProvenanceLog } from '../provenance';

describe('ProvenanceLog', () => {
  let log: ProvenanceLog;

  beforeEach(() => {
    log = new ProvenanceLog();
  });

  it('records an entry and returns it', () => {
    const entry = log.record('ticket.dispatched', { branch: 'feat/abc' }, { ticketId: 'T1' });
    expect(entry.event).toBe('ticket.dispatched');
    expect(entry.ticketId).toBe('T1');
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it('retrieves entries for a specific ticket', () => {
    log.record('ticket.dispatched', {}, { ticketId: 'T1' });
    log.record('ticket.merged', {}, { ticketId: 'T2' });
    log.record('gate.passed', {}, { ticketId: 'T1' });

    const t1Entries = log.getForTicket('T1');
    expect(t1Entries).toHaveLength(2);
    expect(t1Entries.every((e) => e.ticketId === 'T1')).toBe(true);
  });

  it('getAll returns all entries', () => {
    log.record('A', {});
    log.record('B', {});
    expect(log.getAll()).toHaveLength(2);
  });

  it('entries are immutable (getAll returns a copy)', () => {
    log.record('A', {});
    const all = log.getAll();
    all.push({ id: 'fake', event: 'injected', data: {}, timestamp: new Date() });
    expect(log.getAll()).toHaveLength(1);
  });
});
