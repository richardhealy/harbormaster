/** All commands the CLI accepts */
export type CliCommand =
  | { name: 'schedule'; tickets: string[]; mergeThreshold?: number; sequenceThreshold?: number }
  | { name: 'impact'; ticketId: string; files?: string[]; labels?: string[]; title?: string; description?: string }
  | { name: 'lease-acquire'; dispatchId: string; files: string[]; ttlMs?: number }
  | { name: 'lease-release'; leaseId: string }
  | { name: 'trail'; ticketId: string; limit?: number }
  | { name: 'status' }
  | { name: 'help' }

export type CliResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string }
