/**
 * Docker client wrapper using dockerode.
 * Provides typed methods for container and network operations.
 */
import Dockerode from 'dockerode';
import { DockerError } from '../errors.js';
import {
  WORKBENCH_LABELS,
  CONTAINER_TYPES,
  type ContainerInfo,
  type NetworkInfo,
} from './types.js';

/**
 * Docker client configuration options.
 */
export interface DockerClientOptions {
  socketPath?: string;
}

/**
 * Wrapper around dockerode with Workbench-specific operations.
 */
export class DockerClient {
  private docker: Dockerode;

  constructor(options: DockerClientOptions = {}) {
    this.docker = new Dockerode({
      socketPath: options.socketPath ?? '/var/run/docker.sock',
    });
  }

  /**
   * Test connection to Docker daemon.
   */
  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Docker version info.
   */
  async getVersion(): Promise<Dockerode.DockerVersion> {
    try {
      return await this.docker.version();
    } catch (error) {
      throw this.wrapError('Failed to get Docker version', error);
    }
  }

  /**
   * Get underlying dockerode instance for advanced operations.
   */
  getDockerode(): Dockerode {
    return this.docker;
  }

  /**
   * Create a container with Workbench labels.
   */
  async createContainer(
    options: Dockerode.ContainerCreateOptions,
    conversationId: string,
    containerType: (typeof CONTAINER_TYPES)[keyof typeof CONTAINER_TYPES],
  ): Promise<Dockerode.Container> {
    try {
      const labels = {
        ...options.Labels,
        [WORKBENCH_LABELS.MANAGED]: 'true',
        [WORKBENCH_LABELS.CONVERSATION_ID]: conversationId,
        [WORKBENCH_LABELS.CONTAINER_TYPE]: containerType,
      };

      const container = await this.docker.createContainer({
        ...options,
        Labels: labels,
      });

      return container;
    } catch (error) {
      throw this.wrapError(`Failed to create ${containerType} container`, error);
    }
  }

  /**
   * Get a container by ID.
   */
  getContainer(containerId: string): Dockerode.Container {
    return this.docker.getContainer(containerId);
  }

  /**
   * Create a Docker network for session isolation.
   */
  async createNetwork(name: string, conversationId: string): Promise<Dockerode.Network> {
    try {
      const network = await this.docker.createNetwork({
        Name: name,
        Driver: 'bridge',
        Internal: true, // No external access
        Labels: {
          [WORKBENCH_LABELS.MANAGED]: 'true',
          [WORKBENCH_LABELS.CONVERSATION_ID]: conversationId,
        },
      });

      return network;
    } catch (error) {
      throw this.wrapError('Failed to create network', error);
    }
  }

  /**
   * Get a network by ID.
   */
  getNetwork(networkId: string): Dockerode.Network {
    return this.docker.getNetwork(networkId);
  }

  /**
   * List all containers managed by Workbench.
   */
  async listManagedContainers(): Promise<ContainerInfo[]> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: [`${WORKBENCH_LABELS.MANAGED}=true`],
        },
      });

      return containers.map((c) => ({
        id: c.Id,
        name: c.Names[0]?.replace(/^\//, '') ?? '',
        conversationId: c.Labels?.[WORKBENCH_LABELS.CONVERSATION_ID] ?? '',
      }));
    } catch (error) {
      throw this.wrapError('Failed to list managed containers', error);
    }
  }

  /**
   * List all networks managed by Workbench.
   */
  async listManagedNetworks(): Promise<NetworkInfo[]> {
    try {
      const networks = await this.docker.listNetworks({
        filters: {
          label: [`${WORKBENCH_LABELS.MANAGED}=true`],
        },
      });

      return networks.map((n) => ({
        id: n.Id,
        name: n.Name,
        conversationId: n.Labels?.[WORKBENCH_LABELS.CONVERSATION_ID] ?? '',
      }));
    } catch (error) {
      throw this.wrapError('Failed to list managed networks', error);
    }
  }

  /**
   * Remove all orphaned Workbench resources (containers and networks).
   * Useful for cleanup on startup.
   */
  async cleanupOrphans(): Promise<{ containers: number; networks: number }> {
    let containersRemoved = 0;
    let networksRemoved = 0;

    // First, stop and remove all managed containers
    const containers = await this.listManagedContainers();
    for (const info of containers) {
      try {
        const container = this.getContainer(info.id);
        try {
          await container.stop({ t: 5 });
        } catch {
          // Container might already be stopped
        }
        await container.remove({ force: true });
        containersRemoved++;
      } catch {
        // Ignore errors for individual containers
      }
    }

    // Then, remove all managed networks
    const networks = await this.listManagedNetworks();
    for (const info of networks) {
      try {
        const network = this.getNetwork(info.id);
        await network.remove();
        networksRemoved++;
      } catch {
        // Ignore errors for individual networks
      }
    }

    return { containers: containersRemoved, networks: networksRemoved };
  }

  /**
   * Check if an image exists locally.
   */
  async imageExists(imageName: string): Promise<boolean> {
    try {
      const image = this.docker.getImage(imageName);
      await image.inspect();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pull an image if it doesn't exist locally.
   */
  async ensureImage(imageName: string): Promise<void> {
    if (await this.imageExists(imageName)) {
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        // Using callback-style API for pull - void the implicit promise return
        void this.docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err);
            return;
          }

          this.docker.modem.followProgress(
            stream,
            (pullErr: Error | null) => {
              if (pullErr) {
                reject(pullErr);
              } else {
                resolve();
              }
            },
            () => {
              // Progress callback - we can ignore progress events
            },
          );
        });
      });
    } catch (error) {
      throw this.wrapError(`Failed to pull image: ${imageName}`, error);
    }
  }

  /**
   * Wrap error in DockerError with cause.
   */
  private wrapError(message: string, cause: unknown): DockerError {
    const causeError = cause instanceof Error ? cause : new Error(String(cause));
    return new DockerError(message, causeError);
  }
}

/**
 * Create a default Docker client instance.
 */
export function createDockerClient(options?: DockerClientOptions): DockerClient {
  return new DockerClient(options);
}
