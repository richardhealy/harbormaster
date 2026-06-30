import { createInterface } from 'readline'
import type { JSONRPCRequest, JSONRPCResponse, MCPToolDefinition } from './types'

/**
 * MCP (Model Context Protocol) server over stdio, JSON-RPC 2.0.
 *
 * Supports: initialize, tools/list, tools/call, notifications/initialized.
 * Each tool is registered with a handler; unknown methods return -32601.
 */
export class MCPServer {
  private readonly toolsByName = new Map<string, MCPToolDefinition>()

  constructor(private readonly definitions: MCPToolDefinition[]) {
    for (const def of definitions) {
      this.toolsByName.set(def.tool.name, def)
    }
  }

  async handleMessage(message: JSONRPCRequest): Promise<JSONRPCResponse | null> {
    const { id, method, params } = message

    // Notifications have no id and expect no response
    if (method === 'notifications/initialized') return null

    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'harbormaster', version: '0.1.0' },
          },
        }
      }

      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: this.definitions.map((d) => d.tool) },
        }
      }

      if (method === 'tools/call') {
        const { name, arguments: args = {} } = params as {
          name: string
          arguments?: Record<string, unknown>
        }
        const def = this.toolsByName.get(name)
        if (!def) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Unknown tool: ${name}` },
          }
        }
        const result = await def.handler(args as Record<string, unknown>)
        return { jsonrpc: '2.0', id, result }
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      }
    }
  }

  /**
   * Start the MCP server, reading newline-delimited JSON from `input` and
   * writing responses to `output`. Defaults to process.stdin / process.stdout.
   */
  run(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout,
  ): void {
    const rl = createInterface({ input, terminal: false })

    rl.on('line', async (line) => {
      const trimmed = line.trim()
      if (!trimmed) return

      let message: JSONRPCRequest
      try {
        message = JSON.parse(trimmed) as JSONRPCRequest
      } catch {
        const err: JSONRPCResponse = {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }
        output.write(JSON.stringify(err) + '\n')
        return
      }

      const response = await this.handleMessage(message)
      if (response !== null) {
        output.write(JSON.stringify(response) + '\n')
      }
    })
  }
}
