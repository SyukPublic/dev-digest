/**
 * Tool registry primitives.
 *
 * `defineTool` is a thin, typed wrapper over the SDK's `registerTool` config so
 * each tool file declares its `name` / `description` / `annotations` / `handler`
 * in one place, and `registerAll` wires the array into an `McpServer`. Designed
 * so later phases just append a `defineTool(...)` to the registry array.
 *
 * Two cross-cutting concerns live here so individual tools stay thin:
 *  - `jsonResult` shapes a concise structured payload into the MCP text content
 *    block (stringified JSON — the universal, model-friendly format).
 *  - `registerAll` wraps every handler so an `ApiClientError` (or any throw)
 *    becomes a clean `isError` tool result with an action-oriented message,
 *    instead of crashing the JSON-RPC connection.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';
import { ApiClientError } from '../api-client.js';

/**
 * A Zod RAW SHAPE — `Record<string, ZodTypeAny>`, NOT a `z.object(...)`. This is
 * exactly what the SDK's `registerTool` expects as `inputSchema`; it validates
 * args against it and hands the validated object to the callback.
 */
export type InputShape = Record<string, ZodTypeAny>;

/**
 * A registered tool: its namespaced name, SDK config, an optional input shape,
 * and a handler. The handler receives the already-validated args (typed as
 * `Record<string, unknown>` after the SDK validates against `inputSchema` — each
 * tool narrows the fields it declared). Tools with no input omit `inputSchema`.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly config: {
    readonly title?: string;
    readonly description: string;
    readonly annotations?: ToolAnnotations;
    readonly inputSchema?: InputShape;
  };
  readonly handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/** Identity helper that pins the shape of a tool definition. */
export function defineTool(def: ToolDefinition): ToolDefinition {
  return def;
}

/** Wraps a concise structured payload as a single JSON text content block. */
export function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/** An error tool result — surfaced to the model, not thrown over the wire. */
export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/** Registers every tool on the server, wrapping handlers with error mapping. */
export function registerAll(server: McpServer, tools: readonly ToolDefinition[]): void {
  // The SDK's `registerTool` is generic over the input shape and its
  // `ToolCallback<InputArgs>` union is too deep to satisfy structurally with a
  // single uniform callback; type-erase the server's registrar at this one seam.
  const register = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    cb: (args: Record<string, unknown>) => Promise<CallToolResult>,
  ) => unknown;

  for (const tool of tools) {
    // The SDK validates args against `inputSchema` before invoking us; the first
    // callback arg is the validated object (empty for input-less tools).
    const callback = async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        return await tool.handler(args ?? {});
      } catch (err) {
        if (err instanceof ApiClientError) return errorResult(err.message);
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Unexpected error in ${tool.name}: ${message}`);
      }
    };

    register(
      tool.name,
      {
        ...(tool.config.title !== undefined ? { title: tool.config.title } : {}),
        description: tool.config.description,
        ...(tool.config.annotations !== undefined ? { annotations: tool.config.annotations } : {}),
        ...(tool.config.inputSchema !== undefined ? { inputSchema: tool.config.inputSchema } : {}),
      },
      callback,
    );
  }
}
