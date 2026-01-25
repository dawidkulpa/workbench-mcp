/**
 * Idle session reaper.
 * Periodically checks for and destroys sessions that have been idle too long.
 */
import type { SessionManager } from './manager.js';

/**
 * Reaper configuration options.
 */
export interface ReaperOptions {
  /** Interval between reaper runs in milliseconds */
  intervalMs: number;
  /** Logger for reaper events */
  logger?: ReaperLogger;
}

/**
 * Logger interface for reaper events.
 */
export interface ReaperLogger {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}

/**
 * Default no-op logger.
 */
const noopLogger: ReaperLogger = {
  info: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Session reaper that destroys idle sessions.
 */
export class SessionReaper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly logger: ReaperLogger;
  private isRunning = false;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly options: ReaperOptions,
  ) {
    this.logger = options.logger ?? noopLogger;
  }

  /**
   * Start the reaper.
   */
  start(): void {
    if (this.timer) {
      return; // Already running
    }

    this.logger.info(`Starting session reaper with interval ${this.options.intervalMs}ms`);
    this.timer = setInterval(() => {
      void this.reap();
    }, this.options.intervalMs);

    // Don't keep process alive just for reaper
    this.timer.unref();
  }

  /**
   * Stop the reaper.
   */
  stop(): void {
    if (this.timer) {
      this.logger.info('Stopping session reaper');
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Check if the reaper is running.
   */
  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Perform a single reap cycle.
   * Finds and destroys all idle sessions.
   */
  async reap(): Promise<number> {
    // Prevent overlapping reap cycles
    if (this.isRunning) {
      this.logger.debug('Reap cycle already in progress, skipping');
      return 0;
    }

    this.isRunning = true;
    let destroyedCount = 0;

    try {
      const idleSessionIds = this.sessionManager.findIdleSessions();

      if (idleSessionIds.length === 0) {
        this.logger.debug('No idle sessions found');
        return 0;
      }

      this.logger.info(`Found ${idleSessionIds.length} idle session(s) to reap`);

      for (const conversationId of idleSessionIds) {
        try {
          await this.sessionManager.destroy(conversationId);
          destroyedCount++;
          this.logger.info(`Reaped idle session: ${conversationId}`);
        } catch (error) {
          this.logger.error(
            `Failed to reap session ${conversationId}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return destroyedCount;
    } finally {
      this.isRunning = false;
    }
  }
}

/**
 * Create a session reaper with default settings.
 * Default interval is 1 minute (checks every minute for sessions idle > timeout).
 */
export function createSessionReaper(
  sessionManager: SessionManager,
  options?: Partial<ReaperOptions>,
): SessionReaper {
  const defaultIntervalMs = 60 * 1000; // 1 minute

  const reaperOptions: ReaperOptions = {
    intervalMs: options?.intervalMs ?? defaultIntervalMs,
  };

  if (options?.logger) {
    reaperOptions.logger = options.logger;
  }

  return new SessionReaper(sessionManager, reaperOptions);
}
