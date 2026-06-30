import { z } from 'zod'

/**
 * Process environment shape. Everything but `DATABASE_URL` and `PORT` is
 * optional so the control-plane can boot in a partially-configured
 * environment (e.g. local dev without GitHub or Linear credentials) — callers
 * that need a given integration check for its fields themselves.
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

/** Parses and validates `process.env` against {@link ConfigSchema}. Throws if a required field is missing or malformed. */
export function loadConfig(): Config {
  return ConfigSchema.parse(process.env)
}
