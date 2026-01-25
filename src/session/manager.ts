import { Mutex } from '../utils/mutex.js';
import { MaxSessionsError, SessionNotFoundError, DockerError } from '../errors.js';
import type { Session, SessionMetadata } from './types.js';
import type { Config } from '../config/env.js';
import {
  DockerClient,
  createDockerClient,
  createSandbox,
  createProxy,
  createSessionNetwork,
  type SandboxContainer,
  type ProxyContainer,
  type DockerNetwork,
} from '../docker/index.js';

/**
 * Session factory interface for creating sessions.
 * Allows mocking in tests.
 */
export interface SessionFactory {
  create(conversationId: string, config: Config): Promise<Session>;
}

/**
 * Default session factory that creates real Docker containers.
 */
export class DockerSessionFactory implements SessionFactory {
  private dockerClient: DockerClient;

  constructor(dockerClient?: DockerClient) {
    this.dockerClient = dockerClient ?? createDockerClient();
  }

  async create(conversationId: string, config: Config): Promise<Session> {
    let network: DockerNetwork | undefined;
    let sandbox: SandboxContainer | undefined;
    let proxy: ProxyContainer | undefined;

    try {
      // Create isolated network
      network = await createSessionNetwork(this.dockerClient, { conversationId });

      // Create proxy sidecar first (sandbox needs to connect to it)
      proxy = await createProxy(this.dockerClient, {
        conversationId,
        image: config.docker.proxyImage,
        networkId: network.id,
        allowlist: config.proxy.allowlist,
      });

      // Create sandbox container
      sandbox = await createSandbox(this.dockerClient, {
        conversationId,
        image: config.docker.sandboxImage,
        networkId: network.id,
        cpuLimit: config.docker.sandboxCpu,
        memoryLimit: config.docker.sandboxMem,
        ...(config.docker.toolbeltHostPath && {
          toolbeltHostPath: config.docker.toolbeltHostPath,
        }),
      });

      const now = Date.now();
      let lastActivityAt = now;

      const session: Session = {
        conversationId,
        createdAt: now,
        get lastActivityAt() {
          return lastActivityAt;
        },
        sandbox,
        proxy,
        network,
        touch() {
          lastActivityAt = Date.now();
        },
        async destroy() {
          // Destroy sandbox first
          try {
            await sandbox?.destroy();
          } catch {
            // Continue with cleanup even if sandbox destroy fails
          }
          // Then destroy proxy
          try {
            await proxy?.destroy();
          } catch {
            // Continue with network cleanup even if proxy destroy fails
          }
          // Finally destroy network
          try {
            await network?.destroy();
          } catch {
            // Network cleanup failure is not critical
          }
        },
      };

      return session;
    } catch (error) {
      // Cleanup on failure
      if (sandbox) {
        try {
          await sandbox.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
      if (proxy) {
        try {
          await proxy.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
      if (network) {
        try {
          await network.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }

      if (error instanceof DockerError) {
        throw error;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      throw new DockerError('Failed to create session', err);
    }
  }

  /**
   * Get the Docker client for advanced operations.
   */
  getDockerClient(): DockerClient {
    return this.dockerClient;
  }
}

/**
 * Mock session factory for unit testing.
 */
export class MockSessionFactory implements SessionFactory {
  create(conversationId: string, _config: Config): Promise<Session> {
    const now = Date.now();
    let lastActivityAt = now;

    // Create mock sandbox
    const mockSandbox: SandboxContainer = {
      containerId: `sandbox-${conversationId}`,
      container: {} as SandboxContainer['container'],
      exec() {
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
      },
      readFile() {
        return Promise.resolve('');
      },
      writeFile() {
        return Promise.resolve();
      },
      listDir() {
        return Promise.resolve([]);
      },
      destroy() {
        return Promise.resolve();
      },
    };

    // Create mock proxy
    const mockProxy: ProxyContainer = {
      containerId: `proxy-${conversationId}`,
      container: {} as ProxyContainer['container'],
      destroy() {
        return Promise.resolve();
      },
    };

    // Create mock network
    const mockNetwork: DockerNetwork = {
      id: `network-${conversationId}`,
      name: `workbench-${conversationId}`,
      network: {} as DockerNetwork['network'],
      destroy() {
        return Promise.resolve();
      },
    };

    const session: Session = {
      conversationId,
      createdAt: now,
      get lastActivityAt() {
        return lastActivityAt;
      },
      sandbox: mockSandbox,
      proxy: mockProxy,
      network: mockNetwork,
      touch() {
        lastActivityAt = Date.now();
      },
      destroy() {
        return Promise.resolve();
      },
    };

    return Promise.resolve(session);
  }
}

/**
 * Manages session lifecycle with concurrency control.
 * Ensures one conversation maps to exactly one sandbox at a time.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private locks = new Map<string, Mutex>();
  private sessionFactory: SessionFactory;

  constructor(
    private readonly config: Config,
    sessionFactory?: SessionFactory,
  ) {
    // Use mock factory in test environment, Docker factory otherwise
    this.sessionFactory =
      sessionFactory ??
      (config.env === 'test' ? new MockSessionFactory() : new DockerSessionFactory());
  }

  /**
   * Get or create a session for the given conversation ID.
   * Uses mutex to prevent race conditions during session creation.
   */
  async getOrCreate(conversationId: string): Promise<Session> {
    const mutex = this.getOrCreateMutex(conversationId);
    const release = await mutex.acquire();

    try {
      let session = this.sessions.get(conversationId);
      if (!session) {
        // Check max sessions before creating
        if (this.sessions.size >= this.config.session.maxSessions) {
          throw new MaxSessionsError(this.config.session.maxSessions);
        }
        session = await this.sessionFactory.create(conversationId, this.config);
        this.sessions.set(conversationId, session);
      }
      session.touch();
      return session;
    } finally {
      release();
    }
  }

  /**
   * Get an existing session without creating a new one.
   */
  get(conversationId: string): Session {
    const session = this.sessions.get(conversationId);
    if (!session) {
      throw new SessionNotFoundError(conversationId);
    }
    session.touch();
    return session;
  }

  /**
   * Check if a session exists for the given conversation ID.
   */
  has(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  /**
   * Destroy a specific session.
   */
  async destroy(conversationId: string): Promise<void> {
    const mutex = this.getOrCreateMutex(conversationId);
    const release = await mutex.acquire();

    try {
      const session = this.sessions.get(conversationId);
      if (session) {
        await session.destroy();
        this.sessions.delete(conversationId);
      }
      // Clean up mutex if no longer needed
      this.locks.delete(conversationId);
    } finally {
      release();
    }
  }

  /**
   * Destroy all sessions (for graceful shutdown).
   */
  async shutdown(): Promise<void> {
    const destroyPromises = Array.from(this.sessions.keys()).map((id) => this.destroy(id));
    await Promise.allSettled(destroyPromises);
  }

  /**
   * Get all active session metadata.
   */
  listSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values()).map((session) => ({
      conversationId: session.conversationId,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      sandboxContainerId: session.sandbox.containerId,
      proxyContainerId: session.proxy.containerId,
      networkId: session.network.id,
    }));
  }

  /**
   * Get the number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Find sessions that have been idle longer than the timeout.
   */
  findIdleSessions(): string[] {
    const now = Date.now();
    const idleConversationIds: string[] = [];

    for (const [conversationId, session] of this.sessions) {
      if (now - session.lastActivityAt > this.config.session.idleTimeoutMs) {
        idleConversationIds.push(conversationId);
      }
    }

    return idleConversationIds;
  }

  /**
   * Get or create a mutex for the given conversation ID.
   */
  private getOrCreateMutex(conversationId: string): Mutex {
    let mutex = this.locks.get(conversationId);
    if (!mutex) {
      mutex = new Mutex();
      this.locks.set(conversationId, mutex);
    }
    return mutex;
  }
}
