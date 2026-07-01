import 'dotenv/config'
import { loadConfig } from './config'
import { getPool } from './db'
import { createGitHubApp } from './integrations/github'
import { registerWebhooks } from './integrations/github/webhooks'
import { startWebhookServer } from './integrations/github/server'

/**
 * Control-plane entry point. Loads config, verifies database connectivity,
 * and wires up the GitHub App webhooks if credentials are configured.
 * Database and GitHub failures are logged as warnings rather than fatal —
 * the process still starts so the agent-iface CLI/MCP commands that don't
 * need those integrations keep working.
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
    const requiredStatusChecks = (config.GITHUB_REQUIRED_STATUS_CHECKS ?? '')
      .split(',')
      .map((check) => check.trim())
      .filter(Boolean)

    registerWebhooks(githubApp, {
      protectedBranch: config.GITHUB_PROTECTED_BRANCH,
      requiredStatusChecks,
    })
    startWebhookServer(githubApp, config.PORT)
    console.log(`[github] app initialized, webhook receiver listening on :${config.PORT}`)
  } else {
    console.warn('[github] credentials not configured — app disabled')
  }

  console.log('harbormaster ready')
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
