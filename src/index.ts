/**
 * Service entrypoint. Loads config, verifies database connectivity, and
 * wires up the GitHub App integration if credentials are present.
 *
 * Both the database check and the GitHub App setup are best-effort: a
 * missing/unreachable database or missing GitHub credentials log a
 * warning rather than aborting startup, so harbormaster can still run in
 * partially-configured environments (e.g. local dev).
 */
import 'dotenv/config'
import { loadConfig } from './config'
import { getPool } from './db'
import { createGitHubApp } from './integrations/github'
import { registerWebhooks } from './integrations/github/webhooks'

/**
 * Boots the service: loads and validates config, opens the shared DB pool
 * and probes it with `SELECT 1`, then initializes the GitHub App and
 * registers its webhook handlers if `createGitHubApp` returns a non-null
 * app (i.e. GitHub credentials are configured).
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
