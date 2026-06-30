import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ZodError, type ZodTypeAny } from 'zod'
import * as commands from '../commands'
import {
  acquireLeaseSchema,
  buildReleaseManifestSchema,
  checkHotspotSchema,
  createReleaseSchema,
  generateReleaseNotesSchema,
  listActiveLeasesSchema,
  listReleasesSchema,
  planScheduleSchema,
  queryProvenanceSchema,
  recordProvenanceSchema,
  registerHotspotSchema,
  releaseLeaseByHolderSchema,
  releaseLeaseSchema,
  runGateSchema,
} from '../schemas'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function err(error: unknown): ToolResult {
  const message = error instanceof ZodError ? `Invalid input: ${error.message}` : (error as Error).message
  return { content: [{ type: 'text', text: message }], isError: true }
}

interface ToolDef {
  description: string
  schema: ZodTypeAny & { shape: Record<string, ZodTypeAny> }
  run: (args: unknown) => unknown | Promise<unknown>
}

const TOOLS: Record<string, ToolDef> = {
  schedule_plan: {
    description:
      'Estimate per-ticket impact surfaces and produce a conflict-aware dispatch plan: ' +
      'which tickets are safe to run in parallel, which must be sequenced, and which should ' +
      'be merged into one agent job because they overlap heavily.',
    schema: planScheduleSchema,
    run: args => commands.planSchedule(args),
  },
  hotspot_check: {
    description: 'Check whether a list of files touches a registered hotspot, without acquiring a lease.',
    schema: checkHotspotSchema,
    run: args => commands.checkHotspot(args),
  },
  hotspot_register: {
    description: 'Declare (or replace) a hotspot — a small set of paths that require an advisory lease.',
    schema: registerHotspotSchema,
    run: args => commands.registerHotspot(args),
  },
  hotspot_acquire: {
    description: 'Acquire an advisory lease before touching a hotspot. Granted, blocked, or not-required.',
    schema: acquireLeaseSchema,
    run: args => commands.acquireLease(args),
  },
  hotspot_release: {
    description: 'Release a previously acquired lease by its id.',
    schema: releaseLeaseSchema,
    run: args => commands.releaseLease(args),
  },
  hotspot_release_by_holder: {
    description: 'Release every lease held by a given dispatch/agent id (e.g. on dispatch completion or failure).',
    schema: releaseLeaseByHolderSchema,
    run: args => commands.releaseLeaseByHolder(args),
  },
  hotspot_list_active: {
    description: 'List all currently active (non-expired) hotspot leases.',
    schema: listActiveLeasesSchema,
    run: () => commands.listActiveLeases(),
  },
  gate_run: {
    description:
      'Run a dispatch through the scope/CI/QA/HITL gate pipeline under the policy for its domains. ' +
      'Report the CI status you observed and, where applicable, the QA result and human approval decision.',
    schema: runGateSchema,
    run: args => commands.runGatePipeline(args),
  },
  provenance_record: {
    description: 'Append an event to the immutable audit log (dispatch, gate, merge, release, ticket events).',
    schema: recordProvenanceSchema,
    run: args => commands.recordProvenance(args),
  },
  provenance_query: {
    description: 'Query the audit log by ticket, agent, event type, or time range.',
    schema: queryProvenanceSchema,
    run: args => commands.queryProvenance(args),
  },
  release_create: {
    description: 'Create a new release record in the planning stage.',
    schema: createReleaseSchema,
    run: args => commands.createRelease(args),
  },
  release_list: {
    description: 'List releases, optionally filtered by status.',
    schema: listReleasesSchema,
    run: args => commands.listReleases(args),
  },
  release_manifest: {
    description: 'Build a release manifest from the tickets in a Linear team/cycle.',
    schema: buildReleaseManifestSchema,
    run: args => commands.buildReleaseManifest(args),
  },
  release_notes: {
    description: 'Render markdown release notes from an already-built manifest.',
    schema: generateReleaseNotesSchema,
    run: args => commands.generateReleaseNotes(args),
  },
}

/**
 * Builds the harbormaster MCP server: one tool per agent-facing command in
 * `../commands`, sharing the same zod schemas as the CLI. Agents drive the
 * full schedule → dispatch → gate → release loop through these tools rather
 * than shelling out to the CLI.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'harbormaster', version: '0.1.0' })

  // `registerTool` is typed as `<OutputArgs, InputArgs>(...)`, inferred from each
  // tool's distinct zod shape. Looping over the heterogeneous TOOLS map defeats
  // that inference (TS2589: excessively deep instantiation), so the registration
  // call is typed loosely here; every input is still re-validated by the
  // command's own zod schema at runtime.
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: { description: string; inputSchema: Record<string, ZodTypeAny> },
    cb: (args: unknown) => Promise<ToolResult>,
  ) => void

  for (const [name, def] of Object.entries(TOOLS)) {
    registerTool(name, { description: def.description, inputSchema: def.schema.shape }, async args => {
      try {
        return ok(await def.run(args))
      } catch (error) {
        return err(error)
      }
    })
  }

  return server
}
