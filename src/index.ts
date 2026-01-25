import { createServer } from './server.js';
import { loadConfig } from './config/env.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = await createServer(config);

  try {
    await server.listen({
      port: config.server.port,
      host: '0.0.0.0',
    });

    server.log.info(`Workbench MCP server listening on port ${config.server.port}`);

    // Handle graceful shutdown
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
      process.on(signal, () => {
        server.log.info(`Received ${signal}, shutting down...`);
        void server.close().then(() => process.exit(0));
      });
    }
  } catch (error) {
    server.log.error(error, 'Failed to start server');
    process.exit(1);
  }
}

void main();
