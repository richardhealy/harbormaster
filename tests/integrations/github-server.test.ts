import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Server } from 'node:http'
import type { App } from '@octokit/app'

vi.mock('@octokit/webhooks', () => ({
  createNodeMiddleware: vi.fn(() => (req: unknown, res: { statusCode: number; end: (body: string) => void }) => {
    res.statusCode = 200
    res.end('ok')
  }),
}))

import { createNodeMiddleware } from '@octokit/webhooks'
import { startWebhookServer } from '../../src/integrations/github/server'

describe('startWebhookServer', () => {
  let server: Server | undefined

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
    vi.clearAllMocks()
  })

  it('mounts the webhook middleware at the given path and listens on the given port', async () => {
    const app = { webhooks: { on: vi.fn() } } as unknown as App

    server = startWebhookServer(app, 0)
    await new Promise<void>((resolve) => server!.once('listening', resolve))

    expect(createNodeMiddleware).toHaveBeenCalledWith(app.webhooks, { path: '/webhooks/github' })

    const port = (server.address() as { port: number }).port
    const res = await fetch(`http://127.0.0.1:${port}/webhooks/github`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  it('honours a custom webhook path', async () => {
    const app = { webhooks: { on: vi.fn() } } as unknown as App

    server = startWebhookServer(app, 0, '/custom/path')
    await new Promise<void>((resolve) => server!.once('listening', resolve))

    expect(createNodeMiddleware).toHaveBeenCalledWith(app.webhooks, { path: '/custom/path' })
  })
})
