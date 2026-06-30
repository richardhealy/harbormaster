// JSON-RPC 2.0 wire types
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: unknown
}

export interface JsonRpcSuccess<T = unknown> {
  jsonrpc: '2.0'
  id: string | number | null
  result: T
}

export interface JsonRpcError {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcError

/** Standard JSON-RPC 2.0 error codes */
export const RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
} as const

// MCP (Model Context Protocol) types
export interface McpToolProperty {
  type: string
  description?: string
  items?: { type: string }
  enum?: string[]
}

export interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, McpToolProperty>
    required?: string[]
  }
}

export interface McpContent {
  type: 'text'
  text: string
}

export interface McpToolResult {
  content: McpContent[]
  isError?: boolean
}

export interface McpInitializeResult {
  protocolVersion: string
  capabilities: { tools: { listChanged: boolean } }
  serverInfo: { name: string; version: string }
}

export interface McpToolsListResult {
  tools: McpTool[]
}

export interface McpToolCallParams {
  name: string
  arguments?: Record<string, unknown>
}

/** A tool definition combines its schema (for tools/list) with its handler. */
export interface McpToolDefinition {
  schema: McpTool
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>
}
