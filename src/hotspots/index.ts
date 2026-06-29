export interface Hotspot {
  path: string;
  reason: string;
  requiresLease: boolean;
}

export interface LeaseRequest {
  path: string;
  holderId: string;
  ticketId: string;
  ttlSeconds?: number;
}

export interface LeaseResult {
  granted: boolean;
  leaseId?: string;
  expiresAt?: Date;
  blockedBy?: string;
}
