import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { App } from '@octokit/app'
import { registerWebhooks } from '../../src/integrations/github/webhooks'

type Handler = (event: Record<string, unknown>) => Promise<void> | void

function makeFakeApp() {
  const handlers = new Map<string, Handler[]>()
  const on = vi.fn((event: string | string[], handler: Handler) => {
    for (const name of Array.isArray(event) ? event : [event]) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    }
  })
  const app = { webhooks: { on } } as unknown as App
  return { app, handlers }
}

async function fire(handlers: Map<string, Handler[]>, event: string, payload: Record<string, unknown>) {
  for (const handler of handlers.get(event) ?? []) {
    await handler(payload)
  }
}

describe('registerWebhooks', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('warns on a direct push to the protected branch', async () => {
    const { app, handlers } = makeFakeApp()
    registerWebhooks(app, { protectedBranch: 'main' })

    await fire(handlers, 'push', { payload: { ref: 'refs/heads/main', pusher: { name: 'alice' } } })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Direct push to main detected from alice'))
  })

  it('does not warn on a push to a non-protected branch', async () => {
    const { app, handlers } = makeFakeApp()
    registerWebhooks(app, { protectedBranch: 'main' })

    await fire(handlers, 'push', { payload: { ref: 'refs/heads/feat/x', pusher: { name: 'alice' } } })

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('respects a custom protected branch', async () => {
    const { app, handlers } = makeFakeApp()
    registerWebhooks(app, { protectedBranch: 'release' })

    await fire(handlers, 'push', { payload: { ref: 'refs/heads/main', pusher: { name: 'alice' } } })
    expect(warnSpy).not.toHaveBeenCalled()

    await fire(handlers, 'push', { payload: { ref: 'refs/heads/release', pusher: { name: 'alice' } } })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Direct push to release detected from alice'))
  })

  it('protects the branch on installation.created for each accessible repo', async () => {
    const { app, handlers } = makeFakeApp()
    const protectRepo = vi.fn().mockResolvedValue(undefined)
    const octokit = {}
    registerWebhooks(app, { protectedBranch: 'main', requiredStatusChecks: ['ci'], protectRepo })

    await fire(handlers, 'installation.created', {
      octokit,
      payload: { repositories: [{ full_name: 'acme/one' }, { full_name: 'acme/two' }] },
    })

    expect(protectRepo).toHaveBeenCalledWith(octokit, 'acme', 'one', 'main', { requiredStatusChecks: ['ci'] })
    expect(protectRepo).toHaveBeenCalledWith(octokit, 'acme', 'two', 'main', { requiredStatusChecks: ['ci'] })
    expect(protectRepo).toHaveBeenCalledTimes(2)
  })

  it('protects newly added repos on installation_repositories.added', async () => {
    const { app, handlers } = makeFakeApp()
    const protectRepo = vi.fn().mockResolvedValue(undefined)
    const octokit = {}
    registerWebhooks(app, { protectRepo })

    await fire(handlers, 'installation_repositories.added', {
      octokit,
      payload: { repositories_added: [{ full_name: 'acme/three' }] },
    })

    expect(protectRepo).toHaveBeenCalledWith(octokit, 'acme', 'three', 'main', { requiredStatusChecks: [] })
  })

  it('logs a warning instead of throwing when protection fails', async () => {
    const { app, handlers } = makeFakeApp()
    const protectRepo = vi.fn().mockRejectedValue(new Error('missing admin permission'))
    registerWebhooks(app, { protectRepo })

    await fire(handlers, 'installation.created', {
      octokit: {},
      payload: { repositories: [{ full_name: 'acme/one' }] },
    })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to protect main on acme/one'))
  })

  it('logs merged pull requests and completed check suites', async () => {
    const { app, handlers } = makeFakeApp()
    registerWebhooks(app)

    await fire(handlers, 'pull_request.closed', {
      payload: { pull_request: { number: 7, merged: true, base: { ref: 'main' } } },
    })
    await fire(handlers, 'check_suite.completed', {
      payload: { check_suite: { conclusion: 'success' }, repository: { full_name: 'acme/one' } },
    })

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('PR #7 merged into main'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Check suite success on acme/one'))
  })
})
