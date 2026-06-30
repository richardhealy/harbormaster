import { describe, it, expect, beforeEach } from 'vitest'
import {
  HotspotRegistry,
  HotspotLeaseManager,
  createHotspotManager,
} from '../../src/hotspots/index.js'
import type { HotspotDefinition } from '../../src/hotspots/types.js'

const MIGRATIONS_HOTSPOT: HotspotDefinition = {
  id: 'db-migrations',
  description: 'Database migration files — one at a time',
  paths: ['src/db/migrations/'],
  domains: ['db'],
}

const SHARED_CONFIG_HOTSPOT: HotspotDefinition = {
  id: 'shared-config',
  description: 'Shared configuration files',
  paths: ['src/config.ts'],
  domains: [],
}

const CONTRACT_HOTSPOT: HotspotDefinition = {
  id: 'api-contract',
  description: 'Public API surface',
  paths: ['src/api/'],
  domains: ['integrations/github', 'integrations/linear'],
}

// ---------------------------------------------------------------------------
// HotspotRegistry
// ---------------------------------------------------------------------------

describe('HotspotRegistry', () => {
  let registry: HotspotRegistry

  beforeEach(() => {
    registry = new HotspotRegistry([
      MIGRATIONS_HOTSPOT,
      SHARED_CONFIG_HOTSPOT,
      CONTRACT_HOTSPOT,
    ])
  })

  describe('check()', () => {
    it('returns touchesHotspot=false when no files or domains match', () => {
      const result = registry.check({
        files: ['src/scheduler/index.ts', 'src/impact/types.ts'],
        domains: ['scheduler', 'impact'],
      })
      expect(result.touchesHotspot).toBe(false)
      expect(result.matches).toHaveLength(0)
    })

    it('detects a hotspot match on directory prefix', () => {
      const result = registry.check({
        files: ['src/db/migrations/002_add_hotspots.sql'],
        domains: [],
      })
      expect(result.touchesHotspot).toBe(true)
      expect(result.matches).toHaveLength(1)
      expect(result.matches[0].hotspotId).toBe('db-migrations')
      expect(result.matches[0].matchedPaths).toContain('src/db/migrations/002_add_hotspots.sql')
    })

    it('does not match a prefix pattern against a file outside that directory', () => {
      const result = registry.check({
        files: ['src/db/index.ts'],
        domains: [],
      })
      expect(result.touchesHotspot).toBe(false)
    })

    it('detects a hotspot match on exact path', () => {
      const result = registry.check({
        files: ['src/config.ts'],
        domains: [],
      })
      expect(result.touchesHotspot).toBe(true)
      expect(result.matches[0].hotspotId).toBe('shared-config')
    })

    it('does not treat a prefix pattern as matching a file with the same root but extra suffix', () => {
      const result = registry.check({
        files: ['src/config.ts.bak'],
        domains: [],
      })
      expect(result.touchesHotspot).toBe(false)
    })

    it('detects a hotspot match via domain', () => {
      const result = registry.check({
        files: [],
        domains: ['db'],
      })
      expect(result.touchesHotspot).toBe(true)
      expect(result.matches[0].hotspotId).toBe('db-migrations')
      expect(result.matches[0].matchedDomains).toContain('db')
    })

    it('detects matches across multiple hotspots simultaneously', () => {
      const result = registry.check({
        files: [
          'src/db/migrations/002_add_hotspots.sql',
          'src/config.ts',
        ],
        domains: [],
      })
      expect(result.touchesHotspot).toBe(true)
      expect(result.matches).toHaveLength(2)
      const ids = result.matches.map((m) => m.hotspotId)
      expect(ids).toContain('db-migrations')
      expect(ids).toContain('shared-config')
    })

    it('combines path and domain matches in the same hotspot match entry', () => {
      const result = registry.check({
        files: ['src/db/migrations/003_alter.sql'],
        domains: ['db'],
      })
      const match = result.matches.find((m) => m.hotspotId === 'db-migrations')!
      expect(match.matchedPaths).toHaveLength(1)
      expect(match.matchedDomains).toContain('db')
    })
  })

  describe('list()', () => {
    it('returns all registered hotspots', () => {
      const ids = registry.list().map((h) => h.id)
      expect(ids).toContain('db-migrations')
      expect(ids).toContain('shared-config')
      expect(ids).toContain('api-contract')
    })
  })

  describe('get()', () => {
    it('returns the hotspot definition by id', () => {
      const h = registry.get('db-migrations')
      expect(h).toBeDefined()
      expect(h!.paths).toContain('src/db/migrations/')
    })

    it('returns undefined for unknown id', () => {
      expect(registry.get('unknown')).toBeUndefined()
    })
  })
})

// ---------------------------------------------------------------------------
// HotspotLeaseManager
// ---------------------------------------------------------------------------

describe('HotspotLeaseManager', () => {
  let manager: HotspotLeaseManager

  beforeEach(() => {
    manager = new HotspotLeaseManager()
  })

  describe('acquire()', () => {
    it('grants a lease when the hotspot is free', () => {
      const result = manager.acquire('db-migrations', 'dispatch-1')
      expect(result.acquired).toBe(true)
      expect(result.holderId).toBe('dispatch-1')
      expect(result.acquiredAt).toBeInstanceOf(Date)
    })

    it('re-grants the same lease to the same holder (idempotent)', () => {
      manager.acquire('db-migrations', 'dispatch-1')
      const result = manager.acquire('db-migrations', 'dispatch-1')
      expect(result.acquired).toBe(true)
      expect(result.holderId).toBe('dispatch-1')
    })

    it('rejects when the hotspot is held by a different holder', () => {
      manager.acquire('db-migrations', 'dispatch-1')
      const result = manager.acquire('db-migrations', 'dispatch-2')
      expect(result.acquired).toBe(false)
      expect(result.holderId).toBe('dispatch-1')
    })

    it('grants after the previous holder releases', () => {
      manager.acquire('db-migrations', 'dispatch-1')
      manager.release('db-migrations', 'dispatch-1')
      const result = manager.acquire('db-migrations', 'dispatch-2')
      expect(result.acquired).toBe(true)
      expect(result.holderId).toBe('dispatch-2')
    })

    it('grants after a TTL expiry', async () => {
      manager.acquire('db-migrations', 'dispatch-1', 1) // 1 ms TTL

      // spin until the lease expires
      await new Promise((r) => setTimeout(r, 10))

      const result = manager.acquire('db-migrations', 'dispatch-2')
      expect(result.acquired).toBe(true)
      expect(result.holderId).toBe('dispatch-2')
    })

    it('preserves the original acquiredAt timestamp on re-acquire by the same holder', () => {
      const first = manager.acquire('db-migrations', 'dispatch-1')
      const second = manager.acquire('db-migrations', 'dispatch-1')
      expect(second.acquiredAt?.getTime()).toBe(first.acquiredAt?.getTime())
    })

    it('allows concurrent leases on different hotspots', () => {
      const a = manager.acquire('db-migrations', 'dispatch-1')
      const b = manager.acquire('shared-config', 'dispatch-2')
      expect(a.acquired).toBe(true)
      expect(b.acquired).toBe(true)
    })
  })

  describe('release()', () => {
    it('returns true when the holder releases their own lease', () => {
      manager.acquire('db-migrations', 'dispatch-1')
      expect(manager.release('db-migrations', 'dispatch-1')).toBe(true)
    })

    it('returns false when a non-holder tries to release', () => {
      manager.acquire('db-migrations', 'dispatch-1')
      expect(manager.release('db-migrations', 'dispatch-2')).toBe(false)
    })

    it('returns false when the hotspot has no lease', () => {
      expect(manager.release('db-migrations', 'dispatch-1')).toBe(false)
    })

    it('makes the hotspot free after release', () => {
      manager.acquire('db-migrations', 'dispatch-1')
      manager.release('db-migrations', 'dispatch-1')
      expect(manager.currentHolder('db-migrations')).toBeUndefined()
    })
  })

  describe('currentHolder()', () => {
    it('returns undefined for a free hotspot', () => {
      expect(manager.currentHolder('db-migrations')).toBeUndefined()
    })

    it('returns the lease record for a held hotspot', () => {
      manager.acquire('db-migrations', 'dispatch-1')
      const record = manager.currentHolder('db-migrations')
      expect(record).toBeDefined()
      expect(record!.holderId).toBe('dispatch-1')
    })
  })

  describe('pruneExpired()', () => {
    it('removes expired leases and returns the count', async () => {
      manager.acquire('db-migrations', 'dispatch-1', 1)
      manager.acquire('shared-config', 'dispatch-2')

      await new Promise((r) => setTimeout(r, 10))

      const pruned = manager.pruneExpired()
      expect(pruned).toBe(1)
      expect(manager.currentHolder('db-migrations')).toBeUndefined()
      expect(manager.currentHolder('shared-config')).toBeDefined()
    })

    it('returns 0 when nothing has expired', () => {
      manager.acquire('db-migrations', 'dispatch-1', 60_000)
      expect(manager.pruneExpired()).toBe(0)
    })
  })

  describe('listActive()', () => {
    it('returns all non-expired active leases', () => {
      manager.acquire('db-migrations', 'dispatch-1')
      manager.acquire('shared-config', 'dispatch-2')
      const active = manager.listActive()
      expect(active).toHaveLength(2)
      const ids = active.map((r) => r.holderId)
      expect(ids).toContain('dispatch-1')
      expect(ids).toContain('dispatch-2')
    })

    it('excludes expired leases', async () => {
      manager.acquire('db-migrations', 'dispatch-1', 1)
      manager.acquire('shared-config', 'dispatch-2')

      await new Promise((r) => setTimeout(r, 10))

      const active = manager.listActive()
      expect(active).toHaveLength(1)
      expect(active[0].holderId).toBe('dispatch-2')
    })
  })
})

// ---------------------------------------------------------------------------
// createHotspotManager() factory
// ---------------------------------------------------------------------------

describe('createHotspotManager()', () => {
  it('returns a wired registry + lease manager', () => {
    const { registry, leases } = createHotspotManager([MIGRATIONS_HOTSPOT])

    const check = registry.check({ files: ['src/db/migrations/001_initial.sql'], domains: [] })
    expect(check.touchesHotspot).toBe(true)

    const acquire = leases.acquire('db-migrations', 'dispatch-99')
    expect(acquire.acquired).toBe(true)

    expect(leases.release('db-migrations', 'dispatch-99')).toBe(true)
  })
})
