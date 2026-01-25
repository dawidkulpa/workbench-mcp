import Fastify, {
  type FastifyInstance,
  type FastifyError,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import type { Server, IncomingMessage, ServerResponse } from 'http';
import { loadConfig, type Config } from './config/env.js';
import { SessionManager } from './session/manager.js';
import { McpTransport } from './mcp/transport.js';
import { WorkbenchError } from './errors.js';
import { createLifecycleManager } from './lifecycle/index.js';

// Define the server type we're using
type AppFastifyInstance = FastifyInstance<Server, IncomingMessage, ServerResponse>;

/**
 * Create and configure the Fastify server instance.
 */
export async function createServer(config?: Config): Promise<AppFastifyInstance> {
  const resolvedConfig = config ?? loadConfig();

  // Build logger options conditionally
  const loggerOpts =
    resolvedConfig.env === 'development'
      ? {
          level: resolvedConfig.server.logLevel,
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          },
        }
      : {
          level: resolvedConfig.server.logLevel,
        };

  const fastify = Fastify({
    logger: loggerOpts,
  });

  // Create session manager
  const sessionManager = new SessionManager(resolvedConfig);

  // Create lifecycle manager (reaper, orphan cleanup)
  const lifecycleManager = createLifecycleManager(sessionManager, resolvedConfig, {
    info: (msg: string) => fastify.log.info(msg),
    error: (msg: string) => fastify.log.error(msg),
    debug: (msg: string) => fastify.log.debug(msg),
  });

  // Create MCP transport and register routes
  const mcpTransport = new McpTransport(sessionManager);
  mcpTransport.registerRoutes(fastify);

  // Global error handler
  fastify.setErrorHandler(
    (error: FastifyError | WorkbenchError, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof WorkbenchError) {
        request.log.warn({ err: error, code: error.code }, error.message);
        return reply.status(error.statusCode).send({
          error: error.message,
          code: error.code,
        });
      }

      // Fastify validation errors
      if ('validation' in error && error.validation) {
        return reply.status(400).send({
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: error.validation,
        });
      }

      // Unexpected errors
      request.log.error({ err: error }, 'Unexpected error');
      return reply.status(500).send({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    },
  );

  // Graceful shutdown hook
  fastify.addHook('onClose', async () => {
    fastify.log.info('Stopping lifecycle manager...');
    lifecycleManager.shutdown();
    fastify.log.info('Shutting down session manager...');
    await sessionManager.shutdown();
  });

  // Store config, session manager, and lifecycle manager on fastify instance
  fastify.decorate('config', resolvedConfig);
  fastify.decorate('sessionManager', sessionManager);
  fastify.decorate('lifecycleManager', lifecycleManager);

  return fastify;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    sessionManager: SessionManager;
    lifecycleManager: ReturnType<typeof createLifecycleManager>;
  }
}
