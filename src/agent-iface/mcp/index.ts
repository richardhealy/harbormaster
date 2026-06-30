#!/usr/bin/env node
import 'dotenv/config'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './server'

/**
 * Process entry point for `npm run mcp`: connects the harbormaster MCP
 * server to stdio so an agent runtime (Claude Code, Cursor, etc.) can
 * launch it as a subprocess tool server.
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
