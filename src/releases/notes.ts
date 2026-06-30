import type { ReleaseManifest, ReleaseManifestEntry, ReleaseNotesOptions } from './types'

const LABEL_PRIORITY = ['feat', 'feature', 'fix', 'bug', 'chore', 'docs']
const LABEL_DISPLAY_ORDER = ['feat', 'fix', 'chore', 'docs', 'other']

const LABEL_HEADINGS: Record<string, string> = {
  feat: 'Features',
  feature: 'Features',
  fix: 'Bug Fixes',
  bug: 'Bug Fixes',
  chore: 'Maintenance',
  docs: 'Documentation',
  other: 'Other Changes',
}

function normaliseLabel(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('feat') || lower.includes('feature')) return 'feat'
  if (lower.includes('fix') || lower.includes('bug')) return 'fix'
  if (lower.includes('chore')) return 'chore'
  if (lower.includes('doc')) return 'docs'
  return lower
}

function pickGroupLabel(labels: string[]): string {
  for (const priority of LABEL_PRIORITY) {
    const hit = labels.find((l) => l.toLowerCase().includes(priority))
    if (hit) return normaliseLabel(hit)
  }
  return labels.length > 0 ? normaliseLabel(labels[0]) : 'other'
}

function labelHeading(label: string): string {
  return LABEL_HEADINGS[label] ?? label.charAt(0).toUpperCase() + label.slice(1)
}

function formatEntry(
  entry: ReleaseManifestEntry,
  opts: { includeAssignee: boolean; includeUrl: boolean },
): string {
  let line = `- **${entry.identifier}**: ${entry.title}`
  if (opts.includeUrl && entry.url) line += ` ([link](${entry.url}))`
  if (opts.includeAssignee && entry.assigneeId) line += ` _(${entry.assigneeId})_`
  return line
}

export class ReleaseNotesGenerator {
  generate(manifest: ReleaseManifest, options: ReleaseNotesOptions = {}): string {
    const { groupByLabel = true, includeAssignee = false, includeUrl = true } = options
    const lines: string[] = [`# Release ${manifest.version}`, '']

    if (groupByLabel) {
      const groups = this.groupByLabel(manifest.entries)
      for (const [label, entries] of groups) {
        lines.push(`## ${labelHeading(label)}`, '')
        for (const entry of entries) {
          lines.push(formatEntry(entry, { includeAssignee, includeUrl }))
        }
        lines.push('')
      }
    } else {
      for (const entry of manifest.entries) {
        lines.push(formatEntry(entry, { includeAssignee, includeUrl }))
      }
      lines.push('')
    }

    lines.push(`_Generated ${manifest.generatedAt}_`)
    return lines.join('\n').trim()
  }

  private groupByLabel(
    entries: ReleaseManifestEntry[],
  ): Map<string, ReleaseManifestEntry[]> {
    const raw = new Map<string, ReleaseManifestEntry[]>()
    for (const entry of entries) {
      const label = pickGroupLabel(entry.labels)
      if (!raw.has(label)) raw.set(label, [])
      raw.get(label)!.push(entry)
    }

    const sorted = new Map<string, ReleaseManifestEntry[]>()
    for (const l of LABEL_DISPLAY_ORDER) {
      if (raw.has(l)) sorted.set(l, raw.get(l)!)
    }
    for (const [l, ents] of raw) {
      if (!sorted.has(l)) sorted.set(l, ents)
    }
    return sorted
  }
}
