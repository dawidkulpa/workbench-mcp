/**
 * Network manager for per-session isolated Docker networks.
 */
import type Dockerode from 'dockerode';
import { DockerError } from '../errors.js';
import type { DockerClient } from './client.js';
import type { NetworkCreateOptions, DockerNetwork } from './types.js';

const NETWORK_PREFIX = 'workbench-';

/**
 * Create an isolated Docker network for a session.
 */
export async function createSessionNetwork(
  dockerClient: DockerClient,
  options: NetworkCreateOptions,
): Promise<DockerNetwork> {
  const networkName = `${NETWORK_PREFIX}${options.conversationId}`;

  const network = await dockerClient.createNetwork(networkName, options.conversationId);

  return {
    id: network.id,
    name: networkName,
    network,
    async destroy(): Promise<void> {
      try {
        await network.remove();
      } catch (error) {
        // Ignore 404 (not found) and 409 (removal in progress) errors
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 409) {
          return;
        }
        const err = error instanceof Error ? error : new Error(String(error));
        throw new DockerError(`Failed to destroy network: ${networkName}`, err);
      }
    },
  };
}

/**
 * Get an existing network by ID.
 */
export function getNetworkById(
  dockerClient: DockerClient,
  networkId: string,
  name: string,
): DockerNetwork {
  const network = dockerClient.getNetwork(networkId);

  return {
    id: networkId,
    name,
    network,
    async destroy(): Promise<void> {
      try {
        await network.remove();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        throw new DockerError(`Failed to destroy network: ${name}`, err);
      }
    },
  };
}

/**
 * Wait for network to be ready (inspect returns successfully).
 */
export async function waitForNetwork(
  network: Dockerode.Network,
  timeoutMs: number = 5000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await network.inspect();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new DockerError('Network readiness check timed out', undefined);
}

/**
 * Generate a network name from conversation ID.
 */
export function getNetworkName(conversationId: string): string {
  return `${NETWORK_PREFIX}${conversationId}`;
}
