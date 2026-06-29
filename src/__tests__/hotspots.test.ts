import { describe, it, expect, beforeEach } from 'vitest';
import { HotspotRegistry } from '../hotspots';

describe('HotspotRegistry', () => {
  let registry: HotspotRegistry;

  beforeEach(() => {
    registry = new HotspotRegistry(['migrations/001.sql']);
  });

  it('identifies registered hotspots', () => {
    expect(registry.isHotspot('migrations/001.sql')).toBe(true);
    expect(registry.isHotspot('src/app.ts')).toBe(false);
  });

  it('allows dynamically registering hotspots', () => {
    registry.registerHotspot('src/giant-shared.ts');
    expect(registry.isHotspot('src/giant-shared.ts')).toBe(true);
  });

  it('acquires a lease for the first requester', () => {
    const lease = registry.tryAcquire('migrations/001.sql', 'ticket-1', 'agent-1');
    expect(lease).not.toBeNull();
    expect(lease?.ticketId).toBe('ticket-1');
    expect(lease?.path).toBe('migrations/001.sql');
  });

  it('denies lease to a different ticket while one is held', () => {
    registry.tryAcquire('migrations/001.sql', 'ticket-1', 'agent-1');
    const second = registry.tryAcquire('migrations/001.sql', 'ticket-2', 'agent-2');
    expect(second).toBeNull();
  });

  it('allows the same ticket to re-acquire', () => {
    registry.tryAcquire('migrations/001.sql', 'ticket-1', 'agent-1');
    const reacquired = registry.tryAcquire('migrations/001.sql', 'ticket-1', 'agent-1');
    expect(reacquired).not.toBeNull();
  });

  it('releases a lease successfully', () => {
    registry.tryAcquire('migrations/001.sql', 'ticket-1', 'agent-1');
    const released = registry.release('migrations/001.sql', 'ticket-1');
    expect(released).toBe(true);
    expect(registry.getActiveLease('migrations/001.sql')).toBeNull();
  });

  it('does not release a lease held by another ticket', () => {
    registry.tryAcquire('migrations/001.sql', 'ticket-1', 'agent-1');
    const released = registry.release('migrations/001.sql', 'ticket-2');
    expect(released).toBe(false);
  });

  it('returns null for an unleased path', () => {
    expect(registry.getActiveLease('migrations/001.sql')).toBeNull();
  });
});
