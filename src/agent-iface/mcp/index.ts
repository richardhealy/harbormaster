#!/usr/bin/env node
import 'dotenv/config'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './server'

/**
 * Process entrypoint for `npm run mcp` / the published `harbormaster-mcp` bin:
 * wires {@link createMcpServer} to a stdio transport so an MCP-capable agent
 * can drive the scheduler, gates, hotspots, provenance, and releases directly.
 */
async function main(): Promise<void> {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[mcp] harbormaster MCP server listening on stdio')
}

if (require.main === module) {
  main().catch(err => {
    console.error('fatal:', err)
    process.exit(1)
  })
}
