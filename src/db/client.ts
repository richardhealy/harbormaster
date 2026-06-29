import postgres from 'postgres'

let _sql: ReturnType<typeof postgres> | null = null

export function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    const url = process.env['DATABASE_URL']
    if (!url) throw new Error('DATABASE_URL environment variable is required')
    _sql = postgres(url, { max: 10 })
  }
  return _sql
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end()
    _sql = null
  }
}

export async function migrate(sql: ReturnType<typeof postgres>): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  const { resolve, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const schemaPath = resolve(__dirname, 'schema.sql')
  const schema = await readFile(schemaPath, 'utf8')
  await sql.unsafe(schema)
}
