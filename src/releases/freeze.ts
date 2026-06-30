import type { Release, FreezeWindowResult } from './types'

export type ClockFn = () => Date

export class FreezeWindowManager {
  constructor(private readonly clock: ClockFn = () => new Date()) {}

  isFrozen(releases: Release[]): FreezeWindowResult {
    const now = this.clock()
    for (const release of releases) {
      // Explicitly frozen by status
      if (release.status === 'frozen') {
        return {
          frozen: true,
          releaseId: release.id,
          version: release.version,
          freezeAt: release.freezeAt,
        }
      }
      // Freeze window has elapsed but status not yet updated
      if (release.freezeAt && release.freezeAt <= now && release.status === 'planning') {
        return {
          frozen: true,
          releaseId: release.id,
          version: release.version,
          freezeAt: release.freezeAt,
        }
      }
    }
    return { frozen: false }
  }

  shouldFreeze(release: Release): boolean {
    const now = this.clock()
    return release.freezeAt !== undefined && release.freezeAt <= now
  }
}
