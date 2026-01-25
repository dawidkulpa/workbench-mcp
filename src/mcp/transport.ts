import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  JsonRpcRequestSchema,
  createSuccessResponse,
  createErrorResponse,
  MCP_ERROR_CODES,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './schemas.js';
import { MissingConversationIdError, WorkbenchError } from '../errors.js';
import type { SessionManager } from '../session/manager.js';
import type { Session } from '../session/types.js';
import { toolRegistry, executeTool } from './tools/index.js';

/**
 * MCP Streamable HTTP transport handler.
 * Implements the MCP protocol over HTTP with session management.
 */
export class McpTransport {
  constructor(private readonly sessionManager: SessionManager) {}

  /**
   * Register MCP routes on the Fastify instance.
   */
  registerRoutes(fastify: FastifyInstance): void {
    // Main MCP endpoint
    fastify.post('/mcp', {
      handler: this.handleMcpRequest.bind(this),
    });

    // Health check endpoint
    fastify.get('/health', {
      handler: this.handleHealthCheck.bind(this),
    });

    // Session info endpoint (for debugging)
    fastify.get('/sessions', {
      handler: this.handleListSessions.bind(this),
    });
  }

  /**
   * Handle incoming MCP requests.
   */
  private async handleMcpRequest(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<JsonRpcResponse> {
    // Extract conversation ID from header
    const conversationId = request.headers['x-conversation-id'];
    if (!conversationId || typeof conversationId !== 'string') {
      throw new MissingConversationIdError();
    }

    // Parse JSON-RPC request
    let jsonRpcRequest: JsonRpcRequest;
    try {
      jsonRpcRequest = JsonRpcRequestSchema.parse(request.body);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        return reply.send(
          createErrorResponse(null, MCP_ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC request', {
            issues: error.issues,
          }),
        );
      }
      throw error;
    }

    // Get or create session for this conversation
    const session = await this.sessionManager.getOrCreate(conversationId);

    // Route to appropriate handler based on method
    try {
      const result = await this.routeMethod(jsonRpcRequest, session);
      return reply.send(createSuccessResponse(jsonRpcRequest.id, result));
    } catch (error) {
      if (error instanceof WorkbenchError) {
        return reply.status(error.statusCode).send(
          createErrorResponse(jsonRpcRequest.id, MCP_ERROR_CODES.INTERNAL_ERROR, error.message, {
            code: error.code,
          }),
        );
      }
      throw error;
    }
  }

  /**
   * Route MCP method to appropriate handler.
   */
  private async routeMethod(request: JsonRpcRequest, session: Session): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize();

      case 'tools/list':
        return this.handleToolsList();

      case 'tools/call':
        return this.handleToolsCall(request.params, session);

      default:
        throw new WorkbenchError(`Method not found: ${request.method}`, 'METHOD_NOT_FOUND', 404);
    }
  }

  /**
   * Handle MCP initialize request.
   */
  private handleInitialize(): object {
    return {
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'workbench-mcp',
        version: '1.0.0',
      },
      capabilities: {
        tools: {},
      },
    };
  }

  /**
   * Handle tools/list request.
   */
  private handleToolsList(): object {
    return {
      tools: toolRegistry.listTools(),
    };
  }

  /**
   * Handle tools/call request.
   */
  private async handleToolsCall(params: unknown, session: Session): Promise<object> {
    const typedParams = params as { name?: string; arguments?: unknown } | undefined;
    const toolName = typedParams?.name;

    if (!toolName) {
      throw new WorkbenchError('Tool name is required', 'INVALID_PARAMS', 400);
    }

    if (!toolRegistry.has(toolName)) {
      throw new WorkbenchError(`Tool not found: ${toolName}`, 'TOOL_NOT_FOUND', 404);
    }

    return executeTool(toolName, session, typedParams?.arguments ?? {});
  }

  /**
   * Handle health check request.
   */
  private handleHealthCheck(_request: FastifyRequest, reply: FastifyReply): void {
    void reply.send({
      status: 'ok',
      sessions: this.sessionManager.size,
    });
  }

  /**
   * Handle list sessions request.
   */
  private handleListSessions(_request: FastifyRequest, reply: FastifyReply): void {
    void reply.send({
      sessions: this.sessionManager.listSessions(),
    });
  }
}
