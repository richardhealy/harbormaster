#!/usr/bin/env node
import 'dotenv/config'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './server'

/**
 * Process entry point: wires the server built by `createMcpServer` to a
 * real stdio transport. Left as a thin, unexported wrapper so the
 * server-construction logic in `./server` stays importable and testable on
 * its own, without needing a live stdio connection.
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
