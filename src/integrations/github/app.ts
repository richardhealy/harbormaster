import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

export function registerGitHubWebhook(
  app: FastifyInstance,
  secret: string,
): void {
  app.post('/github/webhook', async (req, reply) => {
    const sig = req.headers['x-hub-signature-256']
    if (typeof sig !== 'string') {
      return reply.status(401).send({ error: 'missing signature' })
    }

    const body = JSON.stringify(req.body)
    if (!verifySignature(body, secret, sig)) {
      return reply.status(401).send({ error: 'invalid signature' })
    }

    const event = req.headers['x-github-event'] as string
    await handleWebhookEvent(event, req.body as Record<string, unknown>)

    return reply.status(200).send({ ok: true })
  })
}

function verifySignature(
  payload: string,
  secret: string,
  header: string,
): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
  const buf1 = Buffer.from(expected, 'utf8')
  const buf2 = Buffer.from(header, 'utf8')
  if (buf1.length !== buf2.length) return false
  return timingSafeEqual(buf1, buf2)
}

async function handleWebhookEvent(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  switch (event) {
    case 'push':
      await onPush(payload)
      break
    case 'pull_request':
      await onPullRequest(payload)
      break
    case 'check_run':
      await onCheckRun(payload)
      break
    default:
      // Unhandled events are silently ignored
      break
  }
}

async function onPush(_payload: Record<string, unknown>): Promise<void> {
  // M0 stub: will enforce no direct main pushes in M1
}

async function onPullRequest(
  _payload: Record<string, unknown>,
): Promise<void> {
  // M0 stub: will trigger gate pipeline in M6
}

async function onCheckRun(_payload: Record<string, unknown>): Promise<void> {
  // M0 stub: will drive queue decisions in M2
}
