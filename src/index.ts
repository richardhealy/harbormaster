import 'dotenv/config'
import Fastify from 'fastify'
import { registerGitHubWebhook } from './integrations/github/app.js'

const PORT = parseInt(process.env['PORT'] ?? '3000', 10)
const HOST = process.env['HOST'] ?? '0.0.0.0'
const WEBHOOK_SECRET = process.env['GITHUB_WEBHOOK_SECRET'] ?? ''

async function main(): Promise<void> {
  const app = Fastify({ logger: true })

  app.get('/health', async () => ({ status: 'ok' }))

  if (WEBHOOK_SECRET) {
    registerGitHubWebhook(app, WEBHOOK_SECRET)
  }

  await app.listen({ port: PORT, host: HOST })
}

main().catch((err) => {
  console.error('Fatal error', err)
  process.exit(1)
})
