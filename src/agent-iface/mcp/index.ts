import { MCPServer } from './server'
import { buildTools } from './tools'
import type { MCPServices } from './tools'

export { MCPServer } from './server'
export { buildTools } from './tools'
export type { MCPServices } from './tools'
export type { MCPTool, MCPToolDefinition, MCPToolResult, JSONRPCRequest, JSONRPCResponse } from './types'

/** Create a ready-to-run MCP server wired to the given harbormaster services */
export function createMCPServer(services: MCPServices): MCPServer {
  const tools = buildTools(services)
  return new MCPServer(tools)
}
