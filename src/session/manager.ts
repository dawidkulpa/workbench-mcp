import { Mutex } from '../utils/mutex.js';
import { MaxSessionsError, SessionNotFoundError } from '../errors.js';
import type { Session, SessionMetadata } from './types.js';
import type { Config } from '../config/env.js';

/**
 * Manages session lifecycle with concurrency control.
 * Ensures one conversation maps to exactly one sandbox at a time.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private locks = new Map<string, Mutex>();

  constructor(private readonly config: Config) {}

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
        session = this.createSession(conversationId);
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

  /**
   * Create a new session. This is a placeholder that will be implemented
   * in Phase 2 when Docker integration is added.
   */
  private createSession(conversationId: string): Session {
    // TODO: Implement in Phase 2 with Docker integration
    // For now, create a mock session for testing the manager
    const now = Date.now();
    let lastActivityAt = now;

    const session: Session = {
      conversationId,
      createdAt: now,
      get lastActivityAt() {
        return lastActivityAt;
      },
      sandbox: {
        containerId: `sandbox-${conversationId}`,
      },
      proxy: {
        containerId: `proxy-${conversationId}`,
      },
      network: {
        id: `network-${conversationId}`,
        name: `workbench-${conversationId}`,
      },
      touch() {
        lastActivityAt = Date.now();
      },
      async destroy() {
        // TODO: Implement container cleanup in Phase 2
      },
    };

    return session;
  }
}
