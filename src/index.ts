import 'dotenv/config'
import { loadConfig } from './config'
import { getPool } from './db'
import { createGitHubApp } from './integrations/github'
import { registerWebhooks } from './integrations/github/webhooks'

/**
 * Control-plane service entrypoint. Boots config, the Postgres pool, and
 * the GitHub App, logging a warning and continuing in degraded mode for
 * any piece that isn't configured rather than failing startup — useful for
 * local development without full credentials wired up.
 */
async function main() {
  const config = loadConfig()

  console.log(`harbormaster starting in ${config.NODE_ENV} mode on port ${config.PORT}`)

  const pool = getPool(config.DATABASE_URL)

  try {
    await pool.query('SELECT 1')
    console.log('[db] connected')
  } catch {
    console.warn('[db] not available — continuing without database')
  }

  const githubApp = createGitHubApp()
  if (githubApp) {
    registerWebhooks(githubApp)
    console.log('[github] app initialized')
  } else {
    console.warn('[github] credentials not configured — app disabled')
  }

  console.log('harbormaster ready')
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
