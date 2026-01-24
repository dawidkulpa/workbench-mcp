import { z } from 'zod';

/**
 * MCP JSON-RPC request schema.
 */
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

/**
 * MCP JSON-RPC response (success).
 */
export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

/**
 * MCP JSON-RPC response (error).
 */
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * MCP tool definition.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

/**
 * MCP tool registry.
 */
export interface McpToolRegistry {
  tools: Map<string, McpTool>;
  register(tool: McpTool): void;
  get(name: string): McpTool | undefined;
  list(): McpTool[];
}

// Standard MCP error codes
export const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * Create a JSON-RPC success response.
 */
export function createSuccessResponse(
  id: string | number | null | undefined,
  result: unknown,
): JsonRpcSuccessResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  };
}

/**
 * Create a JSON-RPC error response.
 */
export function createErrorResponse(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data !== undefined && { data }),
    },
  };
}
