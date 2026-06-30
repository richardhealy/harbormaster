import type { ParsedArgs } from './types'

/**
 * Minimal argument parser for the harbormaster CLI.
 *
 * Supports:
 *   --flag value       → flags['flag'] = 'value'
 *   --flag v1 v2       → flags['flag'] = ['v1', 'v2']  (when flag ends with 's' or uses multi)
 *   --bool             → flags['bool'] = true
 *   positional args    → positional[]
 *
 * The first non-flag, non-subcommand token is the command; the second is the subcommand.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | string[] | boolean | number> = {}
  const positional: string[] = []
  let command = ''
  let subcommand: string | undefined

  // Known multi-value flags (accept multiple space-separated values after them)
  const multiFlags = new Set(['files', 'labels', 'expected-files'])

  let i = 0
  while (i < argv.length) {
    const token = argv[i]

    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]

      if (multiFlags.has(key)) {
        // Consume all subsequent non-flag tokens as an array
        i++
        const values: string[] = []
        while (i < argv.length && !argv[i].startsWith('--')) {
          values.push(argv[i])
          i++
        }
        flags[key] = values
        continue
      }

      if (!next || next.startsWith('--')) {
        flags[key] = true
      } else {
        const num = Number(next)
        flags[key] = Number.isNaN(num) ? next : num
        i++
      }
    } else if (!command) {
      command = token
    } else if (!subcommand) {
      subcommand = token
    } else {
      positional.push(token)
    }

    i++
  }

  return { command, subcommand, flags, positional }
}
