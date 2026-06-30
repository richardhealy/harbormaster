import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolDefinition,
  McpToolCallParams,
  McpInitializeResult,
  McpToolsListResult,
} from './types'
import { RPC_ERRORS } from './types'

const PROTOCOL_VERSION = '2024-11-05'

/**
 * Minimal MCP server — JSON-RPC 2.0 over newline-delimited messages.
 *
 * Handles: initialize, tools/list, tools/call, ping.
 * Notifications (no `id`) are silently dropped, as the protocol requires.
 */
export class McpServer {
  private readonly tools: Map<string, McpToolDefinition>

  constructor(tools: McpToolDefinition[]) {
    this.tools = new Map(tools.map(t => [t.schema.name, t]))
  }

  /**
   * Process a single raw line from the transport and return the serialised
   * response, or `null` for notifications that require no reply.
   */
  async handle(line: string): Promise<string | null> {
    const trimmed = line.trim()
    if (!trimmed) return null

    let req: JsonRpcRequest
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      return JSON.stringify({ jsonrpc: '2.0', id: null, error: RPC_ERRORS.PARSE_ERROR })
    }

    // Notifications have no `id`; the spec says do not respond.
    if (req.id === undefined) return null

    const response = await this.handleRequest(req)
    return JSON.stringify(response)
  }

  /** Dispatch a parsed JSON-RPC request to the appropriate handler. */
  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    switch (req.method) {
      case 'initialize': {
        const result: McpInitializeResult = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'harbormaster', version: '0.1.0' },
        }
        return { jsonrpc: '2.0', id: req.id, result }
      }

      case 'ping':
      case 'notifications/initialized':
        return { jsonrpc: '2.0', id: req.id, result: {} }

      case 'tools/list': {
        const result: McpToolsListResult = {
          tools: [...this.tools.values()].map(t => t.schema),
        }
        return { jsonrpc: '2.0', id: req.id, result }
      }

      case 'tools/call': {
        const params = req.params as McpToolCallParams | undefined
        if (!params?.name) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: { ...RPC_ERRORS.INVALID_PARAMS, data: 'tools/call requires params.name' },
          }
        }
        const tool = this.tools.get(params.name)
        if (!tool) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: { code: RPC_ERRORS.METHOD_NOT_FOUND.code, message: `Tool not found: ${params.name}` },
          }
        }
        try {
          const result = await tool.handler(params.arguments ?? {})
          return { jsonrpc: '2.0', id: req.id, result }
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              ...RPC_ERRORS.INTERNAL_ERROR,
              data: err instanceof Error ? err.message : String(err),
            },
          }
        }
      }

      default:
        return { jsonrpc: '2.0', id: req.id, error: RPC_ERRORS.METHOD_NOT_FOUND }
    }
  }

  /**
   * Run the server reading newline-delimited JSON from `input` and writing
   * responses to `output`. Intended for stdio in production and string streams
   * in tests.
   */
  async run(io: McpServerIO): Promise<void> {
    for await (const line of io.lines()) {
      const response = await this.handle(line)
      if (response !== null) io.write(response)
    }
  }
}

/** Transport abstraction — injectable for tests. */
export interface McpServerIO {
  lines(): AsyncIterable<string>
  write(line: string): void
}

/** Production transport: newline-delimited JSON over process.stdin / process.stdout. */
export function createStdioIO(): McpServerIO {
  return {
    lines: () => stdinLines(),
    write: (line: string) => process.stdout.write(line + '\n'),
  }
}

async function* stdinLines(): AsyncIterable<string> {
  let buf = ''
  for await (const chunk of process.stdin) {
    buf += (chunk as Buffer).toString()
    const parts = buf.split('\n')
    buf = parts.pop() ?? ''
    for (const part of parts) yield part
  }
  if (buf) yield buf
}
