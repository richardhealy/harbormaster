import { parseArgs } from './parser'
import { dispatch } from './commands'
import type { CLIServices } from './commands'

export { parseArgs } from './parser'
export { dispatch, handleSchedule, handleHotspot, handleLease, handleHelp } from './commands'
export type { CLIServices } from './commands'
export type { ParsedArgs, CLIResult } from './types'

/**
 * Run the harbormaster CLI against the given argv array and services.
 * Writes to stdout/stderr and calls process.exit with the appropriate code.
 */
export async function runCLI(
  argv: string[],
  services: CLIServices,
  streams: {
    stdout: NodeJS.WritableStream
    stderr: NodeJS.WritableStream
  } = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const args = parseArgs(argv)
  const result = dispatch(args, services)

  const stream = result.exitCode === 0 ? streams.stdout : streams.stderr
  stream.write(result.output + (result.output.endsWith('\n') ? '' : '\n'))

  return result.exitCode
}
