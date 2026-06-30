import type { ManifestEntry, ReleaseManifest } from './types'

const PRIORITY_LABEL: Record<number, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

function priorityLabel(p: number): string {
  return PRIORITY_LABEL[p] ?? 'No priority'
}

function sortByPriority(a: ManifestEntry, b: ManifestEntry): number {
  // No-priority (0) sorts last
  if (a.priority === 0 && b.priority === 0) return 0
  if (a.priority === 0) return 1
  if (b.priority === 0) return -1
  return a.priority - b.priority
}

/** Renders a ReleaseManifest as a Markdown release-notes document. */
export function generateNotes(manifest: ReleaseManifest): string {
  const lines: string[] = [
    `# Release ${manifest.version}`,
    '',
    `_Generated: ${manifest.generatedAt}_`,
    '',
  ]

  if (manifest.totalTickets === 0) {
    lines.push('No tickets in this release.')
    return lines.join('\n')
  }

  // Group entries by their first label; unlabelled go into "Other"
  const byLabel = new Map<string, ManifestEntry[]>()
  for (const entry of manifest.entries) {
    const label = entry.labels[0] ?? 'Other'
    const group = byLabel.get(label) ?? []
    group.push(entry)
    byLabel.set(label, group)
  }

  // Sort groups alphabetically, "Other" always last
  const sorted = [...byLabel.entries()].sort(([a], [b]) => {
    if (a === 'Other') return 1
    if (b === 'Other') return -1
    return a.localeCompare(b)
  })

  lines.push(`## Changes (${manifest.totalTickets} tickets)`, '')

  for (const [label, entries] of sorted) {
    lines.push(`### ${label}`, '')
    for (const entry of [...entries].sort(sortByPriority)) {
      const ref = entry.url ? `[${entry.identifier}](${entry.url})` : entry.identifier
      const pri = priorityLabel(entry.priority)
      lines.push(`- ${ref} — ${entry.title} _(${pri})_`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
