/**
 * Session type definitions.
 */
import type { SandboxContainer, DockerNetwork } from '../docker/types.js';

/**
 * Represents a single sandbox session tied to a conversation.
 */
export interface Session {
  /** Unique conversation identifier (from X-Conversation-Id header) */
  conversationId: string;
  /** Timestamp when session was created */
  createdAt: number;
  /** Timestamp of last activity (for idle timeout) */
  lastActivityAt: number;
  /** Sandbox container wrapper */
  sandbox: SandboxContainer;
  /** Proxy sidecar container information (placeholder for Phase 3) */
  proxy: {
    containerId: string;
  };
  /** Docker network for session isolation */
  network: DockerNetwork;
  /** Update lastActivityAt to current time */
  touch(): void;
  /** Destroy the session and clean up resources */
  destroy(): Promise<void>;
}

/**
 * Session creation options.
 */
export interface SessionCreateOptions {
  conversationId: string;
  sandboxImage: string;
  proxyImage: string;
  cpuLimit: number;
  memoryLimit: string;
  toolbeltPath?: string;
}

/**
 * Session metadata (without destroy method, for serialization).
 */
export interface SessionMetadata {
  conversationId: string;
  createdAt: number;
  lastActivityAt: number;
  sandboxContainerId: string;
  proxyContainerId: string;
  networkId: string;
}
