export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: unknown
}

export interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: JSONRPCError
}

export interface JSONRPCError {
  code: number
  message: string
  data?: unknown
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** Result returned by a tool handler, following MCP spec */
export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** A tool definition: its schema plus an async handler */
export interface MCPToolDefinition {
  tool: MCPTool
  handler: (args: Record<string, unknown>) => Promise<MCPToolResult>
}
