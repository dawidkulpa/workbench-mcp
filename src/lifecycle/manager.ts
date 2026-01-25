/**
 * Lifecycle management for the Workbench MCP server.
 * Handles startup cleanup and background processes.
 */
import { DockerClient, createDockerClient } from '../docker/index.js';
import { SessionManager } from '../session/manager.js';
import { SessionReaper, createSessionReaper, type ReaperLogger } from '../session/reaper.js';
import type { Config } from '../config/env.js';

/**
 * Lifecycle manager handles startup and shutdown tasks.
 */
export class LifecycleManager {
  private reaper: SessionReaper | null = null;
  private dockerClient: DockerClient;
  private logger: ReaperLogger;

  constructor(
    private readonly sessionManager: SessionManager,
    _config: Config,
    logger?: ReaperLogger,
  ) {
    this.dockerClient = createDockerClient();
    this.logger = logger ?? {
      info: console.log.bind(console),
      error: console.error.bind(console),
      debug: () => {},
    };
  }

  /**
   * Perform startup tasks.
   * - Clean up orphaned containers from previous runs
   * - Start the idle session reaper
   */
  async startup(): Promise<StartupResult> {
    const result: StartupResult = {
      orphansRemoved: { containers: 0, networks: 0 },
      reaperStarted: false,
    };

    // Clean up orphans
    try {
      result.orphansRemoved = await this.cleanupOrphans();
      if (result.orphansRemoved.containers > 0 || result.orphansRemoved.networks > 0) {
        this.logger.info(
          `Cleaned up orphaned resources: ${result.orphansRemoved.containers} containers, ${result.orphansRemoved.networks} networks`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to clean up orphans on startup:',
        error instanceof Error ? error.message : String(error),
      );
      // Continue startup even if cleanup fails
    }

    // Start reaper
    this.startReaper();
    result.reaperStarted = true;

    return result;
  }

  /**
   * Perform shutdown tasks.
   * - Stop the reaper
   * - Session cleanup is handled by SessionManager.shutdown()
   */
  shutdown(): void {
    this.stopReaper();
  }

  /**
   * Clean up orphaned Workbench containers and networks.
   */
  async cleanupOrphans(): Promise<{ containers: number; networks: number }> {
    return this.dockerClient.cleanupOrphans();
  }

  /**
   * Start the idle session reaper.
   */
  private startReaper(): void {
    if (this.reaper) {
      return;
    }

    // Check every 30 seconds for idle sessions
    const reaperIntervalMs = 30 * 1000;

    this.reaper = createSessionReaper(this.sessionManager, {
      intervalMs: reaperIntervalMs,
      logger: this.logger,
    });

    this.reaper.start();
  }

  /**
   * Stop the idle session reaper.
   */
  private stopReaper(): void {
    if (this.reaper) {
      this.reaper.stop();
      this.reaper = null;
    }
  }

  /**
   * Get the reaper instance (for testing).
   */
  getReaper(): SessionReaper | null {
    return this.reaper;
  }
}

/**
 * Result of startup tasks.
 */
export interface StartupResult {
  orphansRemoved: {
    containers: number;
    networks: number;
  };
  reaperStarted: boolean;
}

/**
 * Create a lifecycle manager.
 */
export function createLifecycleManager(
  sessionManager: SessionManager,
  config: Config,
  logger?: ReaperLogger,
): LifecycleManager {
  return new LifecycleManager(sessionManager, config, logger);
}
