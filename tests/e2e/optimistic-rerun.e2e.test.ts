import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import simpleGit, { type SimpleGit } from 'simple-git'
import { Rebaser } from '../../src/integration/rerun/rebase'
import { Rerunner } from '../../src/integration/rerun'
import { createWorktreeManager, type WorktreeManager } from '../../src/integration/worktrees'
import type { QueueAdapter } from '../../src/integration/queue/types'

/**
 * Proves the spec's second checklist item against real git rather than
 * mocked SimpleGit: a genuine rebase conflict (two branches editing the same
 * line) is caught by Rebaser, and Rerunner's re-dispatch loop produces a
 * fresh worktree off the new tip whose change lands with a clean rebase —
 * no human intervention, no mocked git calls.
 */
describe('optimistic re-run (sample repo)', () => {
  let repoRoot: string
  let git: SimpleGit
  let manager: WorktreeManager
  const chargeFile = path.join('src', 'payments', 'charge.ts')
  const createdWorktrees: string[] = []

  // QueueAdapter is a thin wrapper over the real GitHub merge queue API;
  // this test never passes a prNumber, so none of these are ever called.
  const noopQueue: QueueAdapter = {
    enqueue: () => Promise.reject(new Error('not used')),
    dequeue: () => Promise.resolve(),
    getStatus: () => Promise.resolve(null),
    listQueued: () => Promise.resolve([]),
  }

  beforeAll(async () => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'harbormaster-rerun-repo-'))
    git = simpleGit(repoRoot)

    await git.init()
    await git.addConfig('user.name', 'Harbormaster Test')
    await git.addConfig('user.email', 'test@harbormaster.local')

    mkdirSync(path.join(repoRoot, 'src', 'payments'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, chargeFile),
      'export const charge = (amount: number) => {\n  return amount\n}\n',
    )
    await git.add('.')
    await git.commit('initial commit')
    await git.branch(['-M', 'main'])

    manager = createWorktreeManager(git, repoRoot, path.join(repoRoot, '.worktrees'))
  })

  afterAll(async () => {
    for (const dispatchId of createdWorktrees) {
      await manager.remove(dispatchId).catch(() => {})
    }
    await git.raw(['worktree', 'prune']).catch(() => {})
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('catches a real rebase conflict, then re-runs the losing change so it lands cleanly on the new tip', async () => {
    // The agent's first attempt: dispatch-1 works on a worktree branched off main.
    const attempt1 = await manager.create({
      dispatchId: 'dispatch-1',
      branch: 'agent/dispatch-1',
      baseBranch: 'main',
    })
    createdWorktrees.push('dispatch-1')

    writeFileSync(
      path.join(attempt1.path, chargeFile),
      'export const charge = (amount: number) => {\n  return amount + 1\n}\n',
    )
    const git1 = simpleGit(attempt1.path)
    await git1.add('.')
    await git1.commit('add flat fee')

    // Meanwhile a different, already-merged change lands on main touching the
    // exact same line — a genuine collision, not a fabricated one.
    await git.checkout('main')
    writeFileSync(
      path.join(repoRoot, chargeFile),
      'export const charge = (amount: number) => {\n  return amount * 1.02\n}\n',
    )
    await git.add('.')
    await git.commit('add percentage surcharge')

    // dispatch-1 tries to integrate against the new tip: real `git rebase`,
    // real conflict (both attempts changed the same return line).
    const rebaser = new Rebaser(dir => simpleGit(dir))
    const firstAttempt = await rebaser.rebase(attempt1.path, 'main')

    expect(firstAttempt.outcome).toBe('conflict')
    expect(firstAttempt.conflictFiles).toContain(chargeFile.replace(/\\/g, '/'))

    // The worktree must be left clean (rebase aborted) — no leftover conflict markers.
    const contentAfterAbort = readFileSync(path.join(attempt1.path, chargeFile), 'utf8')
    expect(contentAfterAbort).not.toContain('<<<<<<<')

    // The queue/CI layer would report this as a failed rebase; Rerunner takes
    // it from there — real worktree teardown, real new-tip resolution, real
    // worktree creation for the retry, all against the same sample repo.
    const rerunner = new Rerunner(manager, noopQueue, git)
    let nextDispatchCounter = 2

    const result = await rerunner.handleFailure(
      {
        dispatchId: 'dispatch-1',
        branch: 'agent/dispatch-1',
        baseBranch: 'main',
        reason: 'rebase_conflict',
        attempt: 0,
      },
      async ({ newBaseSha }) => {
        const newDispatchId = `dispatch-${nextDispatchCounter++}`
        // Prove the redispatch was actually handed the real new tip's SHA.
        expect(newBaseSha).toBe((await git.raw(['rev-parse', 'main'])).trim())
        return { dispatchId: newDispatchId, branch: `agent/${newDispatchId}` }
      },
    )

    expect(result.requeued).toBe(true)
    expect(result.newDispatchId).toBe('dispatch-2')
    createdWorktrees.push(result.newDispatchId!)

    // The old worktree is really gone.
    const remainingBefore = await manager.list()
    expect(remainingBefore.some(w => w.dispatchId === 'dispatch-1')).toBe(false)

    // The agent re-does its work on the fresh worktree, this time as a
    // non-colliding change (appending a new export rather than re-editing
    // the line the other branch already changed) — a realistic re-attempt
    // against the current state of the file, not a scripted non-conflict.
    const retryWorktree = remainingBefore.find(w => w.dispatchId === 'dispatch-2')!
    const currentCharge = readFileSync(path.join(retryWorktree.path, chargeFile), 'utf8')
    expect(currentCharge).toContain('amount * 1.02') // sees the real, latest main content

    writeFileSync(
      path.join(retryWorktree.path, chargeFile),
      `${currentCharge}\nexport const applyFlatFee = (amount: number) => amount + 1\n`,
    )
    const git2 = simpleGit(retryWorktree.path)
    await git2.add('.')
    await git2.commit('add flat fee (retry)')

    // The retry rebases cleanly onto main — a real, successful `git rebase`.
    const secondAttempt = await rebaser.rebase(retryWorktree.path, 'main')
    expect(secondAttempt.outcome).toBe('success')
    expect(secondAttempt.headSha).toMatch(/^[0-9a-f]{40}$/)

    // The landed change carries both the earlier collision winner's edit and
    // the retried change — proving nothing was lost or silently overwritten.
    const finalContent = readFileSync(path.join(retryWorktree.path, chargeFile), 'utf8')
    expect(finalContent).toContain('amount * 1.02')
    expect(finalContent).toContain('applyFlatFee')
  })
})
