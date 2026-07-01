import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import simpleGit, { type SimpleGit } from 'simple-git'
import { ImpactEstimator } from '../../src/impact'
import { Scheduler, type SchedulerTicket } from '../../src/scheduler'
import { createWorktreeManager, type WorktreeManager } from '../../src/integration/worktrees'

/**
 * Proves the spec's headline test against a real git repository rather than
 * mocked git/impact objects: tickets whose impact surfaces overlap are
 * scheduled so they never run concurrently (sequenced into later waves, or
 * merged into one job), while genuinely independent tickets are free to have
 * their worktrees created at the same time. The scheduler and impact
 * estimator run unmodified; only git itself is real (a throwaway repo, not
 * a mock).
 */
describe('headline scheduling test (sample repo)', () => {
  let repoRoot: string
  let worktreeBase: string
  let git: SimpleGit
  let manager: WorktreeManager
  const createdWorktrees: string[] = []

  beforeAll(async () => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'harbormaster-sample-repo-'))
    git = simpleGit(repoRoot)

    await git.init()
    await git.addConfig('user.name', 'Harbormaster Test')
    await git.addConfig('user.email', 'test@harbormaster.local')

    // A small "sample repo" whose directory layout mirrors real ticket impact:
    // payments and notifications are separate domains; both share a utils file.
    mkdirSync(path.join(repoRoot, 'src', 'payments'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'src', 'notifications'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'payments', 'charge.ts'), 'export const charge = () => {}\n')
    writeFileSync(path.join(repoRoot, 'src', 'payments', 'refund.ts'), 'export const refund = () => {}\n')
    writeFileSync(path.join(repoRoot, 'src', 'payments', 'settlement.ts'), 'export const settlement = () => {}\n')
    mkdirSync(path.join(repoRoot, 'src', 'shared'), { recursive: true })
    writeFileSync(path.join(repoRoot, 'src', 'shared', 'utils.ts'), 'export const util = () => {}\n')
    writeFileSync(path.join(repoRoot, 'src', 'notifications', 'email.ts'), 'export const email = () => {}\n')

    await git.add('.')
    await git.commit('initial commit')
    await git.branch(['-M', 'main'])

    worktreeBase = path.join(repoRoot, '.worktrees')
    manager = createWorktreeManager(git, repoRoot, worktreeBase)
  })

  afterAll(async () => {
    for (const dispatchId of createdWorktrees) {
      await manager.remove(dispatchId).catch(() => {})
    }
    await git.raw(['worktree', 'prune']).catch(() => {})
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('sequences overlapping tickets, merges near-identical ones, and lets independent ones share a wave', () => {
    const estimator = new ImpactEstimator()

    // A and B both touch shared/utils.ts: partial overlap -> must not be scheduled together.
    const ticketA = estimator.estimate({
      ticketId: 'ENG-100',
      title: 'Add surcharge to settlement flow',
      expectedFiles: ['src/payments/settlement.ts', 'src/shared/utils.ts'],
    })
    const ticketB = estimator.estimate({
      ticketId: 'ENG-101',
      title: 'Fix refund rounding',
      expectedFiles: ['src/payments/refund.ts', 'src/shared/utils.ts'],
    })
    // C touches an unrelated domain: no overlap with A or B at all.
    const ticketC = estimator.estimate({
      ticketId: 'ENG-102',
      title: 'Add email footer',
      expectedFiles: ['src/notifications/email.ts'],
    })
    // D and E touch the exact same file: overlap so high they must become one job.
    const ticketD = estimator.estimate({
      ticketId: 'ENG-103',
      title: 'Rework charge validation',
      expectedFiles: ['src/payments/charge.ts'],
    })
    const ticketE = estimator.estimate({
      ticketId: 'ENG-104',
      title: 'Add charge validation logging',
      expectedFiles: ['src/payments/charge.ts'],
    })

    const surfaces = new Map([
      [ticketA.ticketId, ticketA],
      [ticketB.ticketId, ticketB],
      [ticketC.ticketId, ticketC],
      [ticketD.ticketId, ticketD],
      [ticketE.ticketId, ticketE],
    ])
    const tickets: SchedulerTicket[] = [...surfaces.keys()].map(ticketId => ({ ticketId }))

    const plan = new Scheduler().plan(tickets, surfaces)

    const groupOf = (ticketId: string) => plan.groups.find(g => g.tickets.includes(ticketId))!
    const waveIndexOf = (groupId: string) => plan.waves.findIndex(wave => wave.some(g => g.id === groupId))

    // D+E collide almost entirely -> merged into a single agent job, never dispatched as two.
    const groupD = groupOf('ENG-103')
    expect(groupD.decision).toBe('merge')
    expect(groupD.tickets.sort()).toEqual(['ENG-103', 'ENG-104'])

    // A and B share shared/utils.ts but are not near-identical -> sequenced, not merged.
    const groupA = groupOf('ENG-100')
    const groupB = groupOf('ENG-101')
    expect(groupA.id).not.toBe(groupB.id)
    expect(waveIndexOf(groupB.id)).toBeGreaterThan(waveIndexOf(groupA.id))

    // C shares nothing with A -> free to land in A's wave.
    const groupC = groupOf('ENG-102')
    expect(waveIndexOf(groupC.id)).toBe(waveIndexOf(groupA.id))
  })

  it('lets non-overlapping groups create worktrees concurrently, and proves overlapping groups are never dispatched together', async () => {
    const estimator = new ImpactEstimator()

    const ticketA = estimator.estimate({ ticketId: 'ENG-200', expectedFiles: ['src/payments/settlement.ts', 'src/shared/utils.ts'], title: 'A' })
    const ticketB = estimator.estimate({ ticketId: 'ENG-201', expectedFiles: ['src/payments/refund.ts', 'src/shared/utils.ts'], title: 'B' })
    const ticketC = estimator.estimate({ ticketId: 'ENG-202', expectedFiles: ['src/notifications/email.ts'], title: 'C' })

    const surfaces = new Map([
      [ticketA.ticketId, ticketA],
      [ticketB.ticketId, ticketB],
      [ticketC.ticketId, ticketC],
    ])
    const tickets: SchedulerTicket[] = [...surfaces.keys()].map(ticketId => ({ ticketId }))
    const plan = new Scheduler().plan(tickets, surfaces)

    // Walk the real dispatch plan wave-by-wave against the real repo: within a
    // wave, create every group's worktree concurrently (proving that's safe);
    // a wave only starts once the previous wave's worktrees exist, mirroring
    // how a real executor would only dispatch the next wave after the first
    // lands. If two overlapping tickets were ever placed in the same wave,
    // `git worktree add` for the second would still succeed (worktrees don't
    // collide on their own), so the real proof is the assertion below: the
    // plan itself never puts A and B in the same wave.
    const dispatchedWaveIndices = new Map<string, number>()

    for (let waveIdx = 0; waveIdx < plan.waves.length; waveIdx++) {
      const wave = plan.waves[waveIdx]
      const infos = await Promise.all(
        wave.map(async group => {
          const dispatchId = `dispatch-${group.id.replace(/[^a-zA-Z0-9]/g, '_')}`
          createdWorktrees.push(dispatchId)
          const info = await manager.create({
            dispatchId,
            branch: `agent/${dispatchId}`,
            baseBranch: 'main',
          })
          dispatchedWaveIndices.set(group.id, waveIdx)
          return info
        }),
      )
      // Every worktree in this wave was actually created on disk off the real repo.
      for (const info of infos) {
        expect(info.headSha).toMatch(/^[0-9a-f]{40}$/)
      }
    }

    const groupOf = (ticketId: string) => plan.groups.find(g => g.tickets.includes(ticketId))!
    const groupA = groupOf('ENG-200')
    const groupB = groupOf('ENG-201')

    // The headline guarantee, proven against real worktrees: A and B overlap
    // on shared/utils.ts, so they were never dispatched in the same wave.
    expect(dispatchedWaveIndices.get(groupA.id)).not.toEqual(dispatchedWaveIndices.get(groupB.id))

    const worktrees = await manager.list()
    expect(worktrees.length).toBe(createdWorktrees.length)
  })
})
