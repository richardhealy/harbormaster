import { HotspotLease, TicketId, AgentId } from '../types';
import { randomUUID } from 'crypto';

const LEASE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export class HotspotRegistry {
  private readonly leases: Map<string, HotspotLease> = new Map();

  private readonly hotspots: Set<string>;

  constructor(hotspotPaths: string[] = []) {
    this.hotspots = new Set(hotspotPaths);
  }

  isHotspot(filePath: string): boolean {
    return this.hotspots.has(filePath);
  }

  registerHotspot(filePath: string): void {
    this.hotspots.add(filePath);
  }

  /**
   * Try to acquire a lease on a hotspot path.
   * Returns the lease if acquired, null if already held by another ticket.
   */
  tryAcquire(path: string, ticketId: TicketId, agentId: AgentId): HotspotLease | null {
    this.evictExpired();

    const existing = this.getActiveLease(path);
    if (existing && existing.ticketId !== ticketId) {
      return null;
    }

    const now = new Date();
    const lease: HotspotLease = {
      id: randomUUID(),
      path,
      ticketId,
      agentId,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
    };

    this.leases.set(path, lease);
    return lease;
  }

  release(path: string, ticketId: TicketId): boolean {
    const lease = this.leases.get(path);
    if (!lease || lease.ticketId !== ticketId) return false;
    this.leases.delete(path);
    return true;
  }

  getActiveLease(path: string): HotspotLease | null {
    this.evictExpired();
    return this.leases.get(path) ?? null;
  }

  private evictExpired(): void {
    const now = new Date();
    for (const [path, lease] of this.leases.entries()) {
      if (lease.expiresAt < now) {
        this.leases.delete(path);
      }
    }
  }
}
