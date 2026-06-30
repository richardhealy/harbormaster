import { describe, it, expect, beforeEach } from 'vitest'
import { HotspotManager, createHotspotManager } from '../../src/hotspots/index.js'
import type { HotspotConfig } from '../../src/hotspots/types.js'

// ---------------------------------------------------------------------------
// Fixture config
// ---------------------------------------------------------------------------

const config: HotspotConfig = {
  hotspots: [
    {
      id: 'db-migrations',
      patterns: 'src/db/migrations',
      description: 'DB migrations — one at a time',
    },
    {
      id: 'shared-types',
      patterns: ['src/types/shared.ts', 'src/types/contracts.ts'],
      description: 'Shared type contracts',
    },
    {
      id: 'glob-hotspot',
      patterns: 'src/generated/*.ts',
      description: 'Any generated TS file',
    },
  ],
  defaultLeaseDurationMs: 60_000, // 1 minute default for tests
}

const noExpiry: HotspotConfig = { ...config, defaultLeaseDurationMs: null }

// ---------------------------------------------------------------------------
// matchHotspots
// ---------------------------------------------------------------------------

describe('HotspotManager.matchHotspots', () => {
  it('matches files under a prefix hotspot', () => {
    const mgr = new HotspotManager(config)
    const matches = mgr.matchHotspots(['src/db/migrations/002_add_column.sql'])
    expect(matches).toHaveLength(1)
    expect(matches[0].hotspot.id).toBe('db-migrations')
    expect(matches[0].matchedFiles).toEqual(['src/db/migrations/002_add_column.sql'])
  })

  it('does not match a path that only shares a partial prefix', () => {
    const mgr = new HotspotManager(config)
    // 'src/db/migrationsfoo' must NOT match 'src/db/migrations'
    const matches = mgr.matchHotspots(['src/db/migrationsfoo'])
    expect(matches).toHaveLength(0)
  })

  it('matches the exact hotspot path itself', () => {
    const mgr = new HotspotManager(config)
    const matches = mgr.matchHotspots(['src/db/migrations'])
    expect(matches).toHaveLength(1)
  })

  it('matches files listed in a multi-pattern hotspot', () => {
    const mgr = new HotspotManager(config)
    const matches = mgr.matchHotspots(['src/types/shared.ts'])
    expect(matches).toHaveLength(1)
    expect(matches[0].hotspot.id).toBe('shared-types')
  })

  it('matches multiple hotspots for a mixed file list', () => {
    const mgr = new HotspotManager(config)
    const matches = mgr.matchHotspots([
      'src/db/migrations/003_index.sql',
      'src/types/contracts.ts',
    ])
    expect(matches).toHaveLength(2)
    const ids = matches.map(m => m.hotspot.id)
    expect(ids).toContain('db-migrations')
    expect(ids).toContain('shared-types')
  })

  it('matches glob-style patterns', () => {
    const mgr = new HotspotManager(config)
    const matches = mgr.matchHotspots(['src/generated/client.ts'])
    expect(matches).toHaveLength(1)
    expect(matches[0].hotspot.id).toBe('glob-hotspot')
  })

  it('does not match a glob pattern for a different extension', () => {
    const mgr = new HotspotManager(config)
    const matches = mgr.matchHotspots(['src/generated/client.js'])
    expect(matches).toHaveLength(0)
  })

  it('returns empty when no files match any hotspot', () => {
    const mgr = new HotspotManager(config)
    const matches = mgr.matchHotspots(['src/scheduler/index.ts', 'src/impact/types.ts'])
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// tryAcquire
// ---------------------------------------------------------------------------

describe('HotspotManager.tryAcquire', () => {
  let mgr: HotspotManager

  beforeEach(() => {
    mgr = new HotspotManager(config)
  })

  it('returns { acquired: true, leases: [] } when no hotspot matches', () => {
    const result = mgr.tryAcquire('dispatch-1', 'ticket-1', ['src/scheduler/index.ts'])
    expect(result.acquired).toBe(true)
    if (result.acquired) {
      expect(result.leases).toHaveLength(0)
    }
  })

  it('acquires a lease when the hotspot is free', () => {
    const result = mgr.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])
    expect(result.acquired).toBe(true)
    if (result.acquired) {
      expect(result.leases).toHaveLength(1)
      expect(result.leases[0].hotspotId).toBe('db-migrations')
      expect(result.leases[0].dispatchId).toBe('dispatch-1')
      expect(result.leases[0].ticketId).toBe('ticket-1')
      expect(result.leases[0].expiresAt).not.toBeNull()
    }
  })

  it('acquires leases on multiple matched hotspots atomically', () => {
    const result = mgr.tryAcquire('dispatch-1', 'ticket-1', [
      'src/db/migrations/001.sql',
      'src/types/shared.ts',
    ])
    expect(result.acquired).toBe(true)
    if (result.acquired) {
      expect(result.leases).toHaveLength(2)
    }
  })

  it('blocks when another dispatch holds the lease', () => {
    mgr.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])
    const result = mgr.tryAcquire('dispatch-2', 'ticket-2', ['src/db/migrations/002.sql'])
    expect(result.acquired).toBe(false)
    if (!result.acquired) {
      expect(result.blocking.dispatchId).toBe('dispatch-1')
      expect(result.hotspotId).toBe('db-migrations')
    }
  })

  it('is atomic: acquires nothing if any hotspot is blocked', () => {
    // dispatch-1 holds db-migrations
    mgr.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])
    // dispatch-2 wants db-migrations AND shared-types
    const result = mgr.tryAcquire('dispatch-2', 'ticket-2', [
      'src/db/migrations/002.sql',
      'src/types/shared.ts',
    ])
    expect(result.acquired).toBe(false)
    // shared-types should NOT have been leased (atomicity)
    const leases = mgr.listLeases()
    expect(leases.filter(l => l.hotspotId === 'shared-types')).toHaveLength(0)
  })

  it('allows the same dispatch to re-acquire its own lease', () => {
    mgr.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])
    const result = mgr.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/002.sql'])
    expect(result.acquired).toBe(true)
    if (result.acquired) {
      // Should not create a duplicate lease for the same hotspot
      expect(result.leases).toHaveLength(1)
    }
    const leases = mgr.listLeases().filter(l => l.hotspotId === 'db-migrations')
    expect(leases).toHaveLength(1)
  })

  it('auto-releases an expired lease and allows a new acquire', () => {
    const expiredConfig: HotspotConfig = {
      ...config,
      defaultLeaseDurationMs: 1, // 1 ms → expires immediately
    }
    const m = new HotspotManager(expiredConfig)
    m.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])

    // Simulate expiry
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const result = m.tryAcquire('dispatch-2', 'ticket-2', ['src/db/migrations/001.sql'])
        expect(result.acquired).toBe(true)
        resolve()
      }, 5)
    })
  })

  it('stores a null expiresAt when no-expiry config is used', () => {
    const m = new HotspotManager(noExpiry)
    const result = m.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])
    expect(result.acquired).toBe(true)
    if (result.acquired) {
      expect(result.leases[0].expiresAt).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------

describe('HotspotManager.release', () => {
  it('releases all leases held by a dispatch', () => {
    const mgr = new HotspotManager(config)
    mgr.tryAcquire('dispatch-1', 'ticket-1', [
      'src/db/migrations/001.sql',
      'src/types/shared.ts',
    ])
    expect(mgr.listLeases()).toHaveLength(2)
    const released = mgr.release('dispatch-1')
    expect(released).toBe(2)
    expect(mgr.listLeases()).toHaveLength(0)
  })

  it('returns 0 for an unknown dispatch', () => {
    const mgr = new HotspotManager(config)
    expect(mgr.release('unknown-dispatch')).toBe(0)
  })

  it('allows a new dispatch to acquire after release', () => {
    const mgr = new HotspotManager(config)
    mgr.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])
    mgr.release('dispatch-1')
    const result = mgr.tryAcquire('dispatch-2', 'ticket-2', ['src/db/migrations/002.sql'])
    expect(result.acquired).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// checkAccess
// ---------------------------------------------------------------------------

describe('HotspotManager.checkAccess', () => {
  it('returns null when no hotspot is leased', () => {
    const mgr = new HotspotManager(config)
    expect(mgr.checkAccess(['src/db/migrations/001.sql'])).toBeNull()
  })

  it('returns the blocking lease for a different dispatch', () => {
    const mgr = new HotspotManager(config)
    mgr.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])
    const blocking = mgr.checkAccess(['src/db/migrations/002.sql'], 'dispatch-2')
    expect(blocking).not.toBeNull()
    expect(blocking?.dispatchId).toBe('dispatch-1')
  })

  it('returns null when the requesting dispatch already holds the lease', () => {
    const mgr = new HotspotManager(config)
    mgr.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])
    expect(mgr.checkAccess(['src/db/migrations/002.sql'], 'dispatch-1')).toBeNull()
  })

  it('does not mutate lease state', () => {
    const mgr = new HotspotManager(config)
    mgr.checkAccess(['src/db/migrations/001.sql'])
    expect(mgr.listLeases()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// listLeases / listHotspots
// ---------------------------------------------------------------------------

describe('HotspotManager.listLeases', () => {
  it('returns empty when no leases are held', () => {
    const mgr = new HotspotManager(config)
    expect(mgr.listLeases()).toHaveLength(0)
  })

  it('returns all active leases', () => {
    const mgr = new HotspotManager(config)
    mgr.tryAcquire('dispatch-1', 'ticket-1', [
      'src/db/migrations/001.sql',
      'src/types/shared.ts',
    ])
    expect(mgr.listLeases()).toHaveLength(2)
  })

  it('evicts expired leases on list', () => {
    const m = new HotspotManager({ ...config, defaultLeaseDurationMs: 1 })
    m.tryAcquire('dispatch-1', 'ticket-1', ['src/db/migrations/001.sql'])
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(m.listLeases()).toHaveLength(0)
        resolve()
      }, 5)
    })
  })
})

describe('HotspotManager.listHotspots', () => {
  it('returns the configured hotspots', () => {
    const mgr = new HotspotManager(config)
    expect(mgr.listHotspots()).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe('createHotspotManager', () => {
  it('creates a HotspotManager instance', () => {
    const mgr = createHotspotManager(config)
    expect(mgr).toBeInstanceOf(HotspotManager)
  })
})
