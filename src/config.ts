import { z } from 'zod'

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

export function loadConfig(): Config {
  return ConfigSchema.parse(process.env)
}
