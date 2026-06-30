import { z } from 'zod'

/**
 * Schema for process environment variables.
 *
 * `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET` and
 * `LINEAR_API_KEY` are intentionally optional: harbormaster must be able to
 * boot without GitHub or Linear integrations configured (e.g. local dev or
 * partial setups), with those integrations simply disabling themselves at
 * runtime when their credentials are absent. `DATABASE_URL`, `PORT`, and
 * `NODE_ENV` have safe local defaults so the service is runnable out of the box.
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

/** Validated, defaulted application configuration derived from `ConfigSchema`. */
export type Config = z.infer<typeof ConfigSchema>

/**
 * Parses and validates `process.env` against {@link ConfigSchema}.
 *
 * Throws a Zod validation error if a required value is the wrong type
 * (e.g. a non-numeric `PORT`); missing optional integration credentials
 * are not an error and simply resolve to `undefined`.
 */
export function loadConfig(): Config {
  return ConfigSchema.parse(process.env)
}
