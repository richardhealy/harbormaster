import type { LinearTicket } from '../integrations/linear/types'
import type { ReleaseManifest, ReleaseManifestEntry } from './types'

export type NowFn = () => string

export class ManifestBuilder {
  constructor(private readonly now: NowFn = () => new Date().toISOString()) {}

  build(
    version: string,
    tickets: LinearTicket[],
    dispatchMap: Map<string, { dispatchId?: string; mergedAt?: string }> = new Map(),
  ): ReleaseManifest {
    const entries: ReleaseManifestEntry[] = tickets
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((t): ReleaseManifestEntry => {
        const dispatch = dispatchMap.get(t.id) ?? {}
        return {
          ticketId: t.id,
          identifier: t.identifier,
          title: t.title,
          labels: t.labels.map((l) => l.name),
          priority: t.priority,
          assigneeId: t.assignee?.id,
          url: t.url,
          dispatchId: dispatch.dispatchId,
          mergedAt: dispatch.mergedAt,
        }
      })

    return {
      version,
      entries,
      generatedAt: this.now(),
    }
  }
}
