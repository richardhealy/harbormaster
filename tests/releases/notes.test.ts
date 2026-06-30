import { describe, it, expect } from 'vitest'
import { generateNotes } from '../../src/releases/notes'
import type { ReleaseManifest } from '../../src/releases/types'

function makeManifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    version: '1.2.0',
    generatedAt: '2026-06-30T12:00:00.000Z',
    totalTickets: 0,
    entries: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Empty manifest
// ---------------------------------------------------------------------------

describe('generateNotes — empty manifest', () => {
  it('includes the version heading', () => {
    const notes = generateNotes(makeManifest())
    expect(notes).toContain('# Release 1.2.0')
  })

  it('includes the generatedAt timestamp', () => {
    const notes = generateNotes(makeManifest())
    expect(notes).toContain('2026-06-30T12:00:00.000Z')
  })

  it('shows "No tickets in this release." when manifest is empty', () => {
    const notes = generateNotes(makeManifest())
    expect(notes).toContain('No tickets in this release.')
  })

  it('does not emit a Changes section for an empty manifest', () => {
    const notes = generateNotes(makeManifest())
    expect(notes).not.toContain('## Changes')
  })
})

// ---------------------------------------------------------------------------
// Grouping and ordering
// ---------------------------------------------------------------------------

describe('generateNotes — grouping', () => {
  const manifest = makeManifest({
    totalTickets: 3,
    entries: [
      { ticketId: 't1', identifier: 'ENG-1', title: 'Fix login bug', labels: ['bug'], priority: 2 },
      { ticketId: 't2', identifier: 'ENG-2', title: 'Add dark mode', labels: ['feature'], priority: 3 },
      { ticketId: 't3', identifier: 'ENG-3', title: 'Update docs', labels: [], priority: 0 },
    ],
  })

  it('includes a Changes heading with total ticket count', () => {
    expect(generateNotes(manifest)).toContain('## Changes (3 tickets)')
  })

  it('creates a section for each distinct label', () => {
    const notes = generateNotes(manifest)
    expect(notes).toContain('### bug')
    expect(notes).toContain('### feature')
  })

  it('puts unlabelled tickets under "Other"', () => {
    expect(generateNotes(manifest)).toContain('### Other')
  })

  it('places "Other" section after named label sections', () => {
    const notes = generateNotes(manifest)
    const featurePos = notes.indexOf('### feature')
    const otherPos = notes.indexOf('### Other')
    expect(otherPos).toBeGreaterThan(featurePos)
  })

  it('sorts label sections alphabetically', () => {
    const notes = generateNotes(manifest)
    const bugPos = notes.indexOf('### bug')
    const featurePos = notes.indexOf('### feature')
    expect(bugPos).toBeLessThan(featurePos)
  })

  it('lists each ticket identifier and title', () => {
    const notes = generateNotes(manifest)
    expect(notes).toContain('ENG-1')
    expect(notes).toContain('Fix login bug')
    expect(notes).toContain('ENG-2')
    expect(notes).toContain('Add dark mode')
  })
})

// ---------------------------------------------------------------------------
// Priority ordering within a group
// ---------------------------------------------------------------------------

describe('generateNotes — priority ordering', () => {
  const manifest = makeManifest({
    totalTickets: 3,
    entries: [
      { ticketId: 't1', identifier: 'ENG-10', title: 'Low task', labels: ['feature'], priority: 4 },
      { ticketId: 't2', identifier: 'ENG-11', title: 'Urgent task', labels: ['feature'], priority: 1 },
      { ticketId: 't3', identifier: 'ENG-12', title: 'No-pri task', labels: ['feature'], priority: 0 },
    ],
  })

  it('shows urgent before low priority', () => {
    const notes = generateNotes(manifest)
    expect(notes.indexOf('ENG-11')).toBeLessThan(notes.indexOf('ENG-10'))
  })

  it('shows no-priority ticket last', () => {
    const notes = generateNotes(manifest)
    expect(notes.indexOf('ENG-12')).toBeGreaterThan(notes.indexOf('ENG-10'))
  })

  it('labels priority in output', () => {
    const notes = generateNotes(manifest)
    expect(notes).toContain('Urgent')
    expect(notes).toContain('Low')
    expect(notes).toContain('No priority')
  })
})

// ---------------------------------------------------------------------------
// URL linking
// ---------------------------------------------------------------------------

describe('generateNotes — URL linking', () => {
  it('renders a Markdown link when url is present', () => {
    const manifest = makeManifest({
      totalTickets: 1,
      entries: [
        {
          ticketId: 't1',
          identifier: 'ENG-42',
          title: 'OAuth2 support',
          labels: ['feature'],
          priority: 2,
          url: 'https://linear.app/issue/ENG-42',
        },
      ],
    })
    const notes = generateNotes(manifest)
    expect(notes).toContain('[ENG-42](https://linear.app/issue/ENG-42)')
  })

  it('renders a plain identifier when url is absent', () => {
    const manifest = makeManifest({
      totalTickets: 1,
      entries: [
        { ticketId: 't1', identifier: 'ENG-43', title: 'Some task', labels: ['bug'], priority: 3 },
      ],
    })
    const notes = generateNotes(manifest)
    expect(notes).toContain('ENG-43 —')
    expect(notes).not.toContain('](')
  })
})
