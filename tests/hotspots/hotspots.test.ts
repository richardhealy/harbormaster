import { describe, it, expect } from 'vitest'
import {
  HotspotLeaseManager,
  createHotspotLeaseManager,
  DEFAULT_HOTSPOTS,
} from '../../src/hotspots/index'
import type { Hotspot } from '../../src/hotspots/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MIGRATION_HOTSPOT: Hotspot = {
  id: 'db-migrations',
  description: 'Database migration files',
  paths: ['src/db/migrations/**', '**/*.migration.sql'],
  advisory: true,
}

const CONTRACT_HOTSPOT: Hotspot = {
  id: 'shared-contracts',
  description: 'Shared type contracts',
  paths: ['src/types/index.ts', 'src/contracts/**'],
  advisory: true,
}

const ALL_HOTSPOTS = [MIGRATION_HOTSPOT, CONTRACT_HOTSPOT]

function makeManager(now = () => 1_000): HotspotLeaseManager {
  return new HotspotLeaseManager({ hotspots: ALL_HOTSPOTS, now })
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

describe('matchHotspots', () => {
  it('returns empty array when no files touch any hotspot', () => {
    const m = makeManager()
    expect(m.matchHotspots(['src/scheduler/index.ts', 'src/impact/types.ts'])).toEqual([])
  })

  it('matches files inside a ** glob', () => {
    const m = makeManager()
    const matches = m.matchHotspots(['src/db/migrations/002_add_column.sql'])
    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe('db-migrations')
  })

  it('matches a file with *.migration.sql suffix pattern', () => {
    const m = makeManager()
    const matches = m.matchHotspots(['db/some_feature.migration.sql'])
    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe('db-migrations')
  })

  it('matches an exact path', () => {
    const m = makeManager()
    const matches = m.matchHotspots(['src/types/index.ts'])
    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe('shared-contracts')
  })

  it('matches a nested path under a ** contract pattern', () => {
    const m = makeManager()
    const matches = m.matchHotspots(['src/contracts/user.ts'])
    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe('shared-contracts')
  })

  it('returns both hotspots when files touch both', () => {
    const m = makeManager()
    const matches = m.matchHotspots([
      'src/db/migrations/001_init.sql',
      'src/types/index.ts',
    ])
    expect(matches).toHaveLength(2)
    expect(matches.map(h => h.id)).toContain('db-migrations')
    expect(matches.map(h => h.id)).toContain('shared-contracts')
  })

  it('deduplicates: two files in the same hotspot return one entry', () => {
    const m = makeManager()
    const matches = m.matchHotspots([
      'src/db/migrations/001.sql',
      'src/db/migrations/002.sql',
    ])
    expect(matches).toHaveLength(1)
  })

  it('does not match a file that only shares a path prefix', () => {
    const m = makeManager()
    // 'src/types/index.tsx' does not match 'src/types/index.ts'
    expect(m.matchHotspots(['src/types/index.tsx'])).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// acquire
// ---------------------------------------------------------------------------

describe('acquire', () => {
  it('returns acquired:true on first acquire', () => {
    const m = makeManager()
    const result = m.acquire('db-migrations', 'dispatch-1')
    expect(result.acquired).toBe(true)
    if (result.acquired) {
      expect(result.lease.hotspotId).toBe('db-migrations')
      expect(result.lease.dispatchId).toBe('dispatch-1')
      expect(result.lease.acquiredAt).toBe(1_000)
      expect(result.lease.expiresAt).toBeNull()
    }
  })

  it('returns acquired:false when a lease is already held', () => {
    const m = makeManager()
    m.acquire('db-migrations', 'dispatch-1')
    const second = m.acquire('db-migrations', 'dispatch-2')
    expect(second.acquired).toBe(false)
    if (!second.acquired) {
      expect(second.heldBy).toBe('dispatch-1')
      expect(second.hotspotId).toBe('db-migrations')
    }
  })

  it('the same dispatch can re-acquire after releasing', () => {
    const m = makeManager()
    m.acquire('db-migrations', 'dispatch-1')
    m.release('db-migrations', 'dispatch-1')
    const result = m.acquire('db-migrations', 'dispatch-1')
    expect(result.acquired).toBe(true)
  })

  it('independent hotspots can be held simultaneously', () => {
    const m = makeManager()
    const r1 = m.acquire('db-migrations', 'dispatch-A')
    const r2 = m.acquire('shared-contracts', 'dispatch-B')
    expect(r1.acquired).toBe(true)
    expect(r2.acquired).toBe(true)
  })

  it('sets expiresAt when leaseTtlMs is configured', () => {
    const m = new HotspotLeaseManager({
      hotspots: ALL_HOTSPOTS,
      leaseTtlMs: 5_000,
      now: () => 1_000,
    })
    const result = m.acquire('db-migrations', 'dispatch-1')
    if (result.acquired) {
      expect(result.lease.expiresAt).toBe(6_000)
    }
  })
})

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------

describe('release', () => {
  it('returns true when the caller holds the lease', () => {
    const m = makeManager()
    m.acquire('db-migrations', 'dispatch-1')
    expect(m.release('db-migrations', 'dispatch-1')).toBe(true)
  })

  it('returns false when a different dispatch tries to release', () => {
    const m = makeManager()
    m.acquire('db-migrations', 'dispatch-1')
    expect(m.release('db-migrations', 'dispatch-2')).toBe(false)
  })

  it('returns false when no lease is held', () => {
    const m = makeManager()
    expect(m.release('db-migrations', 'dispatch-1')).toBe(false)
  })

  it('allows another dispatch to acquire after the holder releases', () => {
    const m = makeManager()
    m.acquire('db-migrations', 'dispatch-1')
    m.release('db-migrations', 'dispatch-1')
    const result = m.acquire('db-migrations', 'dispatch-2')
    expect(result.acquired).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

describe('check', () => {
  it('returns isHeld:false for an unheld hotspot', () => {
    const m = makeManager()
    const status = m.check('db-migrations')
    expect(status.isHeld).toBe(false)
    expect(status.lease).toBeNull()
  })

  it('returns isHeld:true with the current lease when held', () => {
    const m = makeManager()
    m.acquire('db-migrations', 'dispatch-1')
    const status = m.check('db-migrations')
    expect(status.isHeld).toBe(true)
    expect(status.lease?.dispatchId).toBe('dispatch-1')
  })
})

// ---------------------------------------------------------------------------
// listHeld
// ---------------------------------------------------------------------------

describe('listHeld', () => {
  it('returns empty list when no leases are held', () => {
    const m = makeManager()
    expect(m.listHeld()).toEqual([])
  })

  it('returns the active leases', () => {
    const m = makeManager()
    m.acquire('db-migrations', 'dispatch-A')
    m.acquire('shared-contracts', 'dispatch-B')
    const held = m.listHeld()
    expect(held).toHaveLength(2)
    expect(held.map(l => l.hotspotId)).toContain('db-migrations')
    expect(held.map(l => l.hotspotId)).toContain('shared-contracts')
  })

  it('does not list released leases', () => {
    const m = makeManager()
    m.acquire('db-migrations', 'dispatch-A')
    m.acquire('shared-contracts', 'dispatch-B')
    m.release('db-migrations', 'dispatch-A')
    const held = m.listHeld()
    expect(held).toHaveLength(1)
    expect(held[0].hotspotId).toBe('shared-contracts')
  })
})

// ---------------------------------------------------------------------------
// purgeExpired / TTL
// ---------------------------------------------------------------------------

describe('TTL and expiry', () => {
  it('purgeExpired removes a lease whose expiresAt has passed', () => {
    let tick = 1_000
    const m = new HotspotLeaseManager({
      hotspots: ALL_HOTSPOTS,
      leaseTtlMs: 500,
      now: () => tick,
    })
    m.acquire('db-migrations', 'dispatch-1')
    // Advance time past TTL
    tick = 1_501
    const purged = m.purgeExpired()
    expect(purged).toBe(1)
    expect(m.listHeld()).toHaveLength(0)
  })

  it('does not expire a lease before its TTL elapses', () => {
    let tick = 1_000
    const m = new HotspotLeaseManager({
      hotspots: ALL_HOTSPOTS,
      leaseTtlMs: 500,
      now: () => tick,
    })
    m.acquire('db-migrations', 'dispatch-1')
    tick = 1_499 // just before expiry
    const purged = m.purgeExpired()
    expect(purged).toBe(0)
    expect(m.listHeld()).toHaveLength(1)
  })

  it('allows a new dispatch to acquire after TTL expiry', () => {
    let tick = 1_000
    const m = new HotspotLeaseManager({
      hotspots: ALL_HOTSPOTS,
      leaseTtlMs: 500,
      now: () => tick,
    })
    m.acquire('db-migrations', 'dispatch-1')
    tick = 1_600 // past TTL
    const result = m.acquire('db-migrations', 'dispatch-2')
    expect(result.acquired).toBe(true)
  })

  it('check reports isHeld:false after expiry', () => {
    let tick = 1_000
    const m = new HotspotLeaseManager({
      hotspots: ALL_HOTSPOTS,
      leaseTtlMs: 500,
      now: () => tick,
    })
    m.acquire('db-migrations', 'dispatch-1')
    tick = 1_600
    expect(m.check('db-migrations').isHeld).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Factory and defaults
// ---------------------------------------------------------------------------

describe('createHotspotLeaseManager', () => {
  it('creates a manager with DEFAULT_HOTSPOTS when no hotspots passed', () => {
    const m = createHotspotLeaseManager()
    expect(m.hotspots.length).toBe(DEFAULT_HOTSPOTS.length)
  })

  it('creates a manager with provided hotspots', () => {
    const m = createHotspotLeaseManager([MIGRATION_HOTSPOT])
    expect(m.hotspots).toHaveLength(1)
    expect(m.hotspots[0].id).toBe('db-migrations')
  })

  it('DEFAULT_HOTSPOTS includes db-migrations and shared-contracts entries', () => {
    const ids = DEFAULT_HOTSPOTS.map(h => h.id)
    expect(ids).toContain('db-migrations')
    expect(ids).toContain('shared-contracts')
  })

  it('DEFAULT_HOTSPOTS migration pattern matches the project migration path', () => {
    const m = createHotspotLeaseManager()
    const matches = m.matchHotspots(['src/db/migrations/001_initial.sql'])
    expect(matches.some(h => h.id === 'db-migrations')).toBe(true)
  })
})
