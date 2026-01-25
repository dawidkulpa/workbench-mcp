/**
 * Proxy sidecar container operations.
 * Handles proxy lifecycle: create, start, destroy.
 */
import type Dockerode from 'dockerode';
import { DockerError } from '../errors.js';
import type { DockerClient } from './client.js';
import { CONTAINER_TYPES, type ProxyCreateOptions, type ProxyContainer } from './types.js';

const PROXY_NAME_PREFIX = 'workbench-proxy-';
const PROXY_PORT = 3128;

/**
 * Create and start a proxy sidecar container.
 */
export async function createProxy(
  dockerClient: DockerClient,
  options: ProxyCreateOptions,
): Promise<ProxyContainer> {
  const containerName = `${PROXY_NAME_PREFIX}${options.conversationId}`;

  // Join allowlist into comma-separated string
  const allowlistEnv = options.allowlist.join(',');

  // Create container configuration
  const createOptions: Dockerode.ContainerCreateOptions = {
    name: containerName,
    Image: options.image,
    Hostname: 'proxy',
    Tty: false,
    OpenStdin: false,
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    Env: [`PROXY_PORT=${PROXY_PORT}`, `PROXY_ALLOWLIST=${allowlistEnv}`],
    ExposedPorts: {
      [`${PROXY_PORT}/tcp`]: {},
    },
    HostConfig: {
      NetworkMode: options.networkId,
      // Proxy is lightweight - minimal resources
      NanoCpus: 0.25 * 1e9,
      Memory: 128 * 1024 * 1024, // 128MB
      // Security hardening
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      AutoRemove: false,
    },
  };

  // Create the container
  const container = await dockerClient.createContainer(
    createOptions,
    options.conversationId,
    CONTAINER_TYPES.PROXY,
  );

  // Start the container
  try {
    await container.start();
  } catch (error) {
    // Clean up container if start fails
    try {
      await container.remove({ force: true });
    } catch {
      // Ignore cleanup errors
    }
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DockerError('Failed to start proxy container', err);
  }

  // Wait for proxy to be healthy
  await waitForProxy(container);

  // Return wrapper object
  return createProxyWrapper(container, options.conversationId);
}

/**
 * Create a wrapper for an existing proxy container.
 */
function createProxyWrapper(
  container: Dockerode.Container,
  _conversationId: string,
): ProxyContainer {
  return {
    containerId: container.id,
    container,

    async destroy(): Promise<void> {
      try {
        await container.stop({ t: 5 });
      } catch (error: unknown) {
        handleProxyCleanupError(error, 'Failed to stop proxy container');
      }
      try {
        await container.remove({ force: true });
      } catch (error: unknown) {
        handleProxyCleanupError(error, 'Failed to remove proxy container');
      }
    },
  };
}

function isDockerHttpError(error: unknown): error is { statusCode?: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (typeof (error as { statusCode?: number }).statusCode === 'number' ||
      typeof (error as { statusCode?: number }).statusCode === 'undefined')
  );
}

function handleProxyCleanupError(error: unknown, message: string): void {
  if (isDockerHttpError(error)) {
    const statusCode = error.statusCode;
    if (statusCode === 404 || statusCode === 409) {
      // Container already gone or in a conflicting state; ignore as benign.
      return;
    }
  }

  const err = error instanceof Error ? error : new Error(String(error));
  throw new DockerError(message, err);
}
/**
 * Wait for proxy container to be healthy (ready to accept requests).
 */
async function waitForProxy(
  container: Dockerode.Container,
  timeoutMs: number = 10000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const info = await container.inspect();

      // Check if container is running
      if (!info.State.Running) {
        throw new DockerError('Proxy container stopped unexpectedly', undefined);
      }

      // Check health status if available
      const health = info.State.Health;
      if (health) {
        if (health.Status === 'healthy') {
          return;
        }
        if (health.Status === 'unhealthy') {
          throw new DockerError('Proxy container health check failed', undefined);
        }
        // Status is 'starting' - continue waiting but with shorter timeout
        // For proxy, we can be more lenient since it starts fast
      } else {
        // No health check configured - container running is enough
        return;
      }
    } catch (error) {
      if (error instanceof DockerError) {
        throw error;
      }
      // Ignore transient errors during startup
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // If we timeout while still 'starting', that's okay for proxy
  // It just means health checks are slow - verify container is still running
  try {
    const info = await container.inspect();
    if (info.State.Running) {
      return; // Container is running, good enough
    }
    throw new DockerError('Proxy container not running after timeout', undefined);
  } catch (error) {
    if (error instanceof DockerError) {
      throw error;
    }
    throw new DockerError('Failed to verify proxy container status', undefined);
  }
}

/**
 * Get the proxy container name from conversation ID.
 */
export function getProxyName(conversationId: string): string {
  return `${PROXY_NAME_PREFIX}${conversationId}`;
}

/**
 * Get the proxy port.
 */
export function getProxyPort(): number {
  return PROXY_PORT;
}
