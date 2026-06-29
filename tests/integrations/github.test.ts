import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import Fastify from 'fastify'
import { registerGitHubWebhook } from '../../src/integrations/github/app.js'

function makeSignature(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
}

describe('GitHub webhook handler', () => {
  it('returns 401 when signature is missing', async () => {
    const app = Fastify()
    registerGitHubWebhook(app, 'secret')
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      payload: { test: true },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 401 when signature is invalid', async () => {
    const app = Fastify()
    registerGitHubWebhook(app, 'secret')
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'x-hub-signature-256': 'sha256=badhash',
        'x-github-event': 'push',
      },
      payload: { test: true },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 200 for a valid signed push event', async () => {
    const app = Fastify()
    const secret = 'testsecret'
    registerGitHubWebhook(app, secret)
    await app.ready()

    const body = JSON.stringify({ ref: 'refs/heads/main' })
    const sig = makeSignature(body, secret)

    const res = await app.inject({
      method: 'POST',
      url: '/github/webhook',
      headers: {
        'x-hub-signature-256': sig,
        'x-github-event': 'push',
        'content-type': 'application/json',
      },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})
