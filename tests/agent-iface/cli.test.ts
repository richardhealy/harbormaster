import { describe, it, expect, beforeEach } from 'vitest'
import { runCli } from '../../src/agent-iface/cli/index'
import { resetHotspotManager } from '../../src/agent-iface/commands'

describe('runCli', () => {
  beforeEach(() => {
    resetHotspotManager()
  })

  it('prints help with no arguments', async () => {
    const result = await runCli([])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: harbormaster')
    expect(result.stdout).toContain('schedule plan')
  })

  it('runs schedule plan with a JSON payload argument', async () => {
    const payload = JSON.stringify({
      tickets: [{ ticketId: 'ENG-1', title: 'Fix bug', expectedFiles: ['src/x.ts'] }],
    })
    const result = await runCli(['schedule', 'plan', payload])
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.ticketCount).toBe(1)
  })

  it('runs hotspot check and hotspot register as separate invocations', async () => {
    const register = await runCli([
      'hotspot',
      'register',
      JSON.stringify({ name: 'db', patterns: ['src/db/'], reason: 'migrations are costly to redo' }),
    ])
    expect(register.exitCode).toBe(0)

    const check = await runCli(['hotspot', 'check', JSON.stringify({ files: ['src/db/schema.ts'] })])
    expect(check.exitCode).toBe(0)
    expect(JSON.parse(check.stdout).touchesHotspot).toBe(true)
  })

  it('returns a non-zero exit code for an unknown command', async () => {
    const result = await runCli(['not', 'a', 'command'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown command')
  })

  it('returns a non-zero exit code for invalid JSON', async () => {
    const result = await runCli(['gate', 'run', '{not json'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid JSON')
  })

  it('returns a non-zero exit code for a payload that fails schema validation', async () => {
    const result = await runCli(['schedule', 'plan', '{"tickets":[]}'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid input')
  })
})
