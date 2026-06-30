#!/usr/bin/env node
import 'dotenv/config'
import { ZodError } from 'zod'
import * as commands from '../commands'

interface Command {
  description: string
  run: (payload: unknown) => unknown | Promise<unknown>
}

const COMMANDS: Record<string, Command> = {
  'schedule plan': {
    description: 'Estimate impact and produce a dispatch plan for a set of tickets',
    run: payload => commands.planSchedule(payload),
  },
  'hotspot check': {
    description: 'Check whether a file list touches a registered hotspot',
    run: payload => commands.checkHotspot(payload),
  },
  'hotspot register': {
    description: 'Register (or replace) a hotspot definition',
    run: payload => commands.registerHotspot(payload),
  },
  'hotspot acquire': {
    description: 'Acquire an advisory lease for a hotspot',
    run: payload => commands.acquireLease(payload),
  },
  'hotspot release': {
    description: 'Release a lease by id',
    run: payload => commands.releaseLease(payload),
  },
  'hotspot release-by-holder': {
    description: 'Release every lease held by a dispatch/agent id',
    run: payload => commands.releaseLeaseByHolder(payload),
  },
  'hotspot list': {
    description: 'List currently active (non-expired) leases',
    run: () => commands.listActiveLeases(),
  },
  'gate run': {
    description: 'Run the scope/CI/QA/HITL gate pipeline for a dispatch',
    run: payload => commands.runGatePipeline(payload),
  },
  'provenance record': {
    description: 'Append an event to the immutable audit log',
    run: payload => commands.recordProvenance(payload),
  },
  'provenance query': {
    description: 'Query the audit log',
    run: payload => commands.queryProvenance(payload),
  },
  'release create': {
    description: 'Create a new release record',
    run: payload => commands.createRelease(payload),
  },
  'release list': {
    description: 'List releases, optionally filtered by status',
    run: payload => commands.listReleases(payload),
  },
  'release manifest': {
    description: 'Build a release manifest from Linear',
    run: payload => commands.buildReleaseManifest(payload),
  },
  'release notes': {
    description: 'Render release notes markdown from a manifest',
    run: payload => commands.generateReleaseNotes(payload),
  },
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

function printHelp(): void {
  const lines = ['Usage: harbormaster <command> [json-payload]', '', 'Commands:']
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(28)} ${cmd.description}`)
  }
  lines.push(
    '',
    'The payload is a JSON object. Pass it as the last argument, or pipe it via stdin with --stdin.',
    'Example: harbormaster hotspot check \'{"files":["src/db/migrations/001.sql"]}\'',
  )
  process.stdout.write(lines.join('\n') + '\n')
}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Runs the CLI against an argv array and returns captured output instead of touching the real process. */
export async function runCli(argv: string[]): Promise<CliResult> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    let stdout = ''
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string) => {
      stdout += chunk
      return true
    }) as typeof process.stdout.write
    printHelp()
    process.stdout.write = original
    return { exitCode: 0, stdout, stderr: '' }
  }

  // Greedily match the longest known command name against leading argv tokens.
  let commandName: string | undefined
  let rest: string[] = []
  for (let take = Math.min(3, argv.length); take >= 1; take--) {
    const candidate = argv.slice(0, take).join(' ')
    if (COMMANDS[candidate]) {
      commandName = candidate
      rest = argv.slice(take)
      break
    }
  }

  if (!commandName) {
    return { exitCode: 1, stdout: '', stderr: `Unknown command: ${argv.join(' ')}\nRun with --help to list commands.\n` }
  }

  const useStdin = rest.includes('--stdin')
  const positional = rest.filter(a => a !== '--stdin')

  let raw: string
  if (useStdin) {
    raw = await readStdin()
  } else if (positional.length > 0) {
    raw = positional[0]
  } else {
    raw = '{}'
  }

  let payload: unknown
  try {
    payload = raw.trim().length === 0 ? {} : JSON.parse(raw)
  } catch (err) {
    return { exitCode: 1, stdout: '', stderr: `Invalid JSON payload: ${(err as Error).message}\n` }
  }

  try {
    const result = await COMMANDS[commandName].run(payload)
    return { exitCode: 0, stdout: JSON.stringify(result, null, 2) + '\n', stderr: '' }
  } catch (err) {
    if (err instanceof ZodError) {
      return { exitCode: 1, stdout: '', stderr: `Invalid input: ${err.message}\n` }
    }
    return { exitCode: 1, stdout: '', stderr: `${(err as Error).message}\n` }
  }
}

async function main(): Promise<void> {
  const { exitCode, stdout, stderr } = await runCli(process.argv.slice(2))
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
  process.exitCode = exitCode
}

if (require.main === module) {
  main()
}
