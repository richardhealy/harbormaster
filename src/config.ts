import { z } from 'zod'

/**
 * Environment schema for the control-plane process. GitHub and Linear
 * credentials are optional so the service can boot in dev/test with those
 * integrations disabled rather than failing to start.
 */
const ConfigSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://localhost:5432/harbormaster'),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_PROTECTED_BRANCH: z.string().default('main'),
  GITHUB_REQUIRED_STATUS_CHECKS: z.string().optional(),
  LINEAR_API_KEY: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Config = z.infer<typeof ConfigSchema>

/**
 * Parses and validates `process.env` against {@link ConfigSchema}. Throws a
 * zod error if a required value is missing or malformed.
 */
export function loadConfig(): Config {
  return ConfigSchema.parse(process.env)
}
