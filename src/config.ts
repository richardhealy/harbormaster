import { z } from 'zod'

/**
 * Environment variable schema for the control-plane service. GitHub and
 * Linear credentials are optional so the service can boot in a degraded
 * mode (e.g. local dev without a configured GitHub App) — callers that
 * depend on them should check for `undefined` rather than assume presence.
 */
const ConfigSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://localhost:5432/harbormaster'),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  LINEAR_API_KEY: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Config = z.infer<typeof ConfigSchema>

/** Parses and validates `process.env` against {@link ConfigSchema}. Throws if a required value is malformed. */
export function loadConfig(): Config {
  return ConfigSchema.parse(process.env)
}
