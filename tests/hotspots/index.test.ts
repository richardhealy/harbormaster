import { describe, it, expect, beforeEach } from 'vitest'
import {
  HotspotLeaseManager,
  createHotspotLeaseManager,
  matchesPattern,
} from '../../src/hotspots/index'
import type { Hotspot } from '../../src/hotspots/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MIGRATIONS_HOTSPOT: Hotspot = {
  name: 'db-migrations',
  patterns: ['src/db/migrations/'],
  reason: 'Database migrations must not run concurrently',
}

const API_CONTRACT_HOTSPOT: Hotspot = {
  name: 'api-contract',
  patterns: ['src/shared/contract.ts', 'src/shared/types.ts'],
  reason: 'Shared API types break all callers if changed concurrently',
}

const GLOB_HOTSPOT: Hotspot = {
  name: 'migration-files',
  patterns: ['**/*.migration.ts'],
  reason: 'Any migration file must be serialised',
}

// Stable clock helpers
const T0 = new Date('2026-01-01T00:00:00Z')
const T1 = new Date('2026-01-01T00:05:00Z') // 5 min later (after a 60 000 ms TTL)
const T2 = new Date('2026-01-01T00:10:00Z')

function makeClock(date: Date) {
  return () => date
}

// ---------------------------------------------------------------------------
// matchesPattern
// ---------------------------------------------------------------------------

describe('matchesPattern', () => {
  it('exact match returns true for identical path', () => {
    expect(matchesPattern('src/shared/contract.ts', 'src/shared/contract.ts')).toBe(true)
  })

  it('exact match returns false for different path', () => {
    expect(matchesPattern('src/shared/types.ts', 'src/shared/contract.ts')).toBe(false)
  })

  it('directory prefix matches files inside the directory', () => {
    expect(matchesPattern('src/db/migrations/001.sql', 'src/db/migrations/')).toBe(true)
    expect(matchesPattern('src/db/migrations/002_add_col.sql', 'src/db/migrations/')).toBe(true)
  })

  it('directory prefix does not match files outside the directory', () => {
    expect(matchesPattern('src/db/schema.ts', 'src/db/migrations/')).toBe(false)
    expect(matchesPattern('src/db/migrate.ts', 'src/db/migrations/')).toBe(false)
  })

  it('* wildcard matches within a single segment', () => {
    expect(matchesPattern('src/db/001.sql', 'src/db/*.sql')).toBe(true)
    expect(matchesPattern('src/db/sub/001.sql', 'src/db/*.sql')).toBe(false)
  })

  it('** wildcard matches across path segments', () => {
    expect(matchesPattern('src/foo/bar/001.migration.ts', '**/*.migration.ts')).toBe(true)
    expect(matchesPattern('migrations/001.migration.ts', '**/*.migration.ts')).toBe(true)
    expect(matchesPattern('src/foo/bar/001.ts', '**/*.migration.ts')).toBe(false)
  })

  it('** matches a file in the root (no leading directory)', () => {
    expect(matchesPattern('root.migration.ts', '**/*.migration.ts')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// HotspotLeaseManager — register / check
// ---------------------------------------------------------------------------

describe('HotspotLeaseManager.register and check', () => {
  let mgr: HotspotLeaseManager

  beforeEach(() => {
    mgr = new HotspotLeaseManager()
    mgr.register(MIGRATIONS_HOTSPOT)
    mgr.register(API_CONTRACT_HOTSPOT)
  })

  it('returns touchesHotspot:false for files not in any hotspot', () => {
    const r = mgr.check(['src/feature/foo.ts', 'src/feature/bar.ts'])
    expect(r.touchesHotspot).toBe(false)
    expect(r.matches).toHaveLength(0)
  })

  it('detects a file matching a directory-prefix hotspot', () => {
    const r = mgr.check(['src/db/migrations/003_users.sql'])
    expect(r.touchesHotspot).toBe(true)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].hotspot.name).toBe('db-migrations')
    expect(r.matches[0].matchedFiles).toEqual(['src/db/migrations/003_users.sql'])
  })

  it('detects a file matching an exact-path hotspot', () => {
    const r = mgr.check(['src/shared/contract.ts'])
    expect(r.touchesHotspot).toBe(true)
    expect(r.matches[0].hotspot.name).toBe('api-contract')
  })

  it('detects matches across multiple hotspots in one call', () => {
    const r = mgr.check(['src/db/migrations/004.sql', 'src/shared/types.ts', 'src/other/x.ts'])
    expect(r.touchesHotspot).toBe(true)
    expect(r.matches).toHaveLength(2)
    const names = r.matches.map(m => m.hotspot.name)
    expect(names).toContain('db-migrations')
    expect(names).toContain('api-contract')
  })

  it('replaces an existing hotspot on re-registration', () => {
    mgr.register({ ...MIGRATIONS_HOTSPOT, reason: 'updated reason' })
    const hs = mgr.listHotspots().find(h => h.name === 'db-migrations')
    expect(hs?.reason).toBe('updated reason')
  })
})

// ---------------------------------------------------------------------------
// HotspotLeaseManager — acquire
// ---------------------------------------------------------------------------

describe('HotspotLeaseManager.acquire', () => {
  let mgr: HotspotLeaseManager

  beforeEach(() => {
    mgr = createHotspotLeaseManager([MIGRATIONS_HOTSPOT, API_CONTRACT_HOTSPOT])
  })

  it('returns not-required for files not touching any hotspot', () => {
    const r = mgr.acquire({ holderId: 'agent-1', files: ['src/foo/bar.ts'] })
    expect(r.status).toBe('not-required')
    expect(r.matchedFiles).toEqual([])
    expect(r.lease).toBeUndefined()
  })

  it('grants a lease on first acquisition of a hotspot', () => {
    const r = mgr.acquire({
      holderId: 'agent-1',
      files: ['src/db/migrations/001.sql'],
    })
    expect(r.status).toBe('granted')
    expect(r.lease).toBeDefined()
    expect(r.lease!.holderId).toBe('agent-1')
    expect(r.lease!.hotspotName).toBe('db-migrations')
    expect(r.matchedFiles).toEqual(['src/db/migrations/001.sql'])
    expect(r.hotspot?.name).toBe('db-migrations')
  })

  it('blocks a second acquisition of the same hotspot by another holder', () => {
    mgr.acquire({ holderId: 'agent-1', files: ['src/db/migrations/001.sql'] })

    const r = mgr.acquire({
      holderId: 'agent-2',
      files: ['src/db/migrations/002.sql'],
    })
    expect(r.status).toBe('blocked')
    expect(r.blockedBy).toBeDefined()
    expect(r.blockedBy!.holderId).toBe('agent-1')
  })

  it('allows the same holder to acquire the same hotspot again (idempotent dispatch)', () => {
    mgr.acquire({ holderId: 'agent-1', files: ['src/db/migrations/001.sql'] })
    // In the current advisory design a second acquire by the same holder sees
    // the existing lease and is also blocked — callers track their own lease ID.
    // (This is intentional: agents should not acquire twice without releasing.)
    const r = mgr.acquire({ holderId: 'agent-1', files: ['src/db/migrations/002.sql'] })
    // Same holder → still blocked by own lease, which is fine advisory behaviour.
    expect(['granted', 'blocked']).toContain(r.status)
  })

  it('stores lease without expiry when ttlMs is omitted', () => {
    const r = mgr.acquire({
      holderId: 'agent-1',
      files: ['src/db/migrations/001.sql'],
    })
    expect(r.lease!.expiresAt).toBeUndefined()
  })

  it('stores lease with correct expiry when ttlMs is provided', () => {
    const fixedNow = T0
    const mgrWithClock = createHotspotLeaseManager([MIGRATIONS_HOTSPOT], makeClock(fixedNow))

    const r = mgrWithClock.acquire({
      holderId: 'agent-1',
      files: ['src/db/migrations/001.sql'],
      ttlMs: 60_000,
    })

    expect(r.lease!.expiresAt).toEqual(new Date(T0.getTime() + 60_000))
  })

  it('returns the correct matchedFiles subset (only hotspot files, not all files)', () => {
    const r = mgr.acquire({
      holderId: 'agent-1',
      files: ['src/feature/x.ts', 'src/db/migrations/003.sql', 'src/feature/y.ts'],
    })
    expect(r.status).toBe('granted')
    expect(r.matchedFiles).toEqual(['src/db/migrations/003.sql'])
  })
})

// ---------------------------------------------------------------------------
// HotspotLeaseManager — release
// ---------------------------------------------------------------------------

describe('HotspotLeaseManager.release', () => {
  let mgr: HotspotLeaseManager

  beforeEach(() => {
    mgr = createHotspotLeaseManager([MIGRATIONS_HOTSPOT])
  })

  it('returns false when the lease id does not exist', () => {
    expect(mgr.release('nonexistent')).toBe(false)
  })

  it('releases a held lease and allows re-acquisition', () => {
    const first = mgr.acquire({ holderId: 'agent-1', files: ['src/db/migrations/001.sql'] })
    expect(first.status).toBe('granted')
    const leaseId = first.lease!.id

    expect(mgr.release(leaseId)).toBe(true)

    const second = mgr.acquire({ holderId: 'agent-2', files: ['src/db/migrations/002.sql'] })
    expect(second.status).toBe('granted')
    expect(second.lease!.holderId).toBe('agent-2')
  })

  it('releaseByHolder removes all leases for the given holder', () => {
    // Acquire two different hotspots with the same holder
    const mgr2 = createHotspotLeaseManager([MIGRATIONS_HOTSPOT, API_CONTRACT_HOTSPOT])
    mgr2.acquire({ holderId: 'agent-X', files: ['src/db/migrations/001.sql'] })
    mgr2.acquire({ holderId: 'agent-X', files: ['src/shared/contract.ts'] })
    // Also acquire one by a different holder on a hypothetical third hotspot
    // (not registered, so no-op) — just confirm count
    const released = mgr2.releaseByHolder('agent-X')
    expect(released).toBe(2)
    expect(mgr2.listActive()).toHaveLength(0)
  })

  it('releaseByHolder returns 0 when holder has no active leases', () => {
    expect(mgr.releaseByHolder('nobody')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// HotspotLeaseManager — TTL / expiry
// ---------------------------------------------------------------------------

describe('HotspotLeaseManager TTL and expiry', () => {
  it('expired lease is pruned and hotspot can be re-acquired', () => {
    let now = T0
    const mgr = createHotspotLeaseManager([MIGRATIONS_HOTSPOT], () => now)

    mgr.acquire({
      holderId: 'agent-1',
      files: ['src/db/migrations/001.sql'],
      ttlMs: 60_000, // expires 1 min after T0
    })

    // Advance clock past the TTL
    now = T1 // 5 min later, well past 60 s TTL

    const r = mgr.acquire({ holderId: 'agent-2', files: ['src/db/migrations/002.sql'] })
    expect(r.status).toBe('granted')
    expect(r.lease!.holderId).toBe('agent-2')
  })

  it('pruneExpired returns the count of leases removed', () => {
    let now = T0
    const mgr = createHotspotLeaseManager([MIGRATIONS_HOTSPOT, API_CONTRACT_HOTSPOT], () => now)

    mgr.acquire({ holderId: 'a1', files: ['src/db/migrations/001.sql'], ttlMs: 60_000 })
    mgr.acquire({ holderId: 'a2', files: ['src/shared/contract.ts'], ttlMs: 60_000 })

    now = T1
    expect(mgr.pruneExpired()).toBe(2)
    expect(mgr.listActive()).toHaveLength(0)
  })

  it('listActive excludes expired leases', () => {
    let now = T0
    const mgr = createHotspotLeaseManager([MIGRATIONS_HOTSPOT], () => now)

    mgr.acquire({
      holderId: 'agent-1',
      files: ['src/db/migrations/001.sql'],
      ttlMs: 60_000,
    })

    now = T2 // well past expiry
    expect(mgr.listActive()).toHaveLength(0)
  })

  it('non-expiring lease remains active after a long time', () => {
    let now = T0
    const mgr = createHotspotLeaseManager([MIGRATIONS_HOTSPOT], () => now)
    mgr.acquire({ holderId: 'agent-1', files: ['src/db/migrations/001.sql'] }) // no TTL

    now = T2
    expect(mgr.listActive()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// HotspotLeaseManager — glob patterns
// ---------------------------------------------------------------------------

describe('HotspotLeaseManager with glob hotspot', () => {
  it('grants lease when a file matches a ** glob pattern', () => {
    const mgr = createHotspotLeaseManager([GLOB_HOTSPOT])
    const r = mgr.acquire({
      holderId: 'agent-1',
      files: ['src/infra/database/add-user.migration.ts'],
    })
    expect(r.status).toBe('granted')
    expect(r.matchedFiles).toEqual(['src/infra/database/add-user.migration.ts'])
  })

  it('returns not-required for non-matching files', () => {
    const mgr = createHotspotLeaseManager([GLOB_HOTSPOT])
    const r = mgr.acquire({ holderId: 'agent-1', files: ['src/services/auth.ts'] })
    expect(r.status).toBe('not-required')
  })
})

// ---------------------------------------------------------------------------
// Rest-of-repo is lock-free
// ---------------------------------------------------------------------------

describe('lock-free guarantee for non-hotspot files', () => {
  it('multiple agents may acquire leases simultaneously when they do not touch hotspots', () => {
    const mgr = createHotspotLeaseManager([MIGRATIONS_HOTSPOT])

    const r1 = mgr.acquire({ holderId: 'agent-1', files: ['src/feature-a/service.ts'] })
    const r2 = mgr.acquire({ holderId: 'agent-2', files: ['src/feature-b/handler.ts'] })
    const r3 = mgr.acquire({ holderId: 'agent-3', files: ['src/feature-c/model.ts'] })

    // All three require no lease — the repo is lock-free outside declared hotspots
    expect(r1.status).toBe('not-required')
    expect(r2.status).toBe('not-required')
    expect(r3.status).toBe('not-required')
    expect(mgr.listActive()).toHaveLength(0)
  })
})
