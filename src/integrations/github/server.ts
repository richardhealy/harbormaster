import { createServer, type Server } from 'node:http'
import { createNodeMiddleware } from '@octokit/webhooks'
import type { App } from '@octokit/app'

/**
 * Starts an HTTP server that receives GitHub webhook deliveries and feeds
 * them into `app.webhooks`. Without this, handlers registered via
 * `registerWebhooks` are wired up in memory but nothing ever invokes them —
 * GitHub POSTs deliveries to a URL, and nothing was listening on one.
 */
export function startWebhookServer(app: App, port: number, path = '/webhooks/github'): Server {
  const middleware = createNodeMiddleware(app.webhooks, { path })
  return createServer(middleware).listen(port)
}
