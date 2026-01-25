import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../../../src/session/manager.js';
import { MaxSessionsError, SessionNotFoundError } from '../../../src/errors.js';
import type { Config } from '../../../src/config/env.js';

const createTestConfig = (overrides: Partial<Config> = {}): Config => ({
  server: {
    port: 3000,
    logLevel: 'info',
    apiToken: undefined,
  },
  session: {
    maxSessions: 5,
    idleTimeoutMs: 600000,
  },
  docker: {
    sandboxImage: 'workbench-sandbox:1.0',
    proxyImage: 'workbench-proxy:1.0',
    toolbeltHostPath: undefined,
    sandboxCpu: 0.5,
    sandboxMem: '512m',
    execTimeoutMs: 60000,
  },
  proxy: {
    allowlist: [],
  },
  audit: {
    logPath: './audit.jsonl',
    verbose: false,
  },
  env: 'test',
  ...overrides,
});

describe('SessionManager', () => {
  let manager: SessionManager;
  let config: Config;

  beforeEach(() => {
    config = createTestConfig();
    manager = new SessionManager(config);
  });

  describe('getOrCreate', () => {
    it('should create a new session for new conversation', async () => {
      const session = await manager.getOrCreate('conv-1');

      expect(session.conversationId).toBe('conv-1');
      expect(session.sandbox.containerId).toBe('sandbox-conv-1');
      expect(manager.size).toBe(1);
    });

    it('should return existing session for same conversation', async () => {
      const session1 = await manager.getOrCreate('conv-1');
      const session2 = await manager.getOrCreate('conv-1');

      expect(session1).toBe(session2);
      expect(manager.size).toBe(1);
    });

    it('should create separate sessions for different conversations', async () => {
      const session1 = await manager.getOrCreate('conv-1');
      const session2 = await manager.getOrCreate('conv-2');

      expect(session1.conversationId).toBe('conv-1');
      expect(session2.conversationId).toBe('conv-2');
      expect(manager.size).toBe(2);
    });

    it('should throw MaxSessionsError when limit reached', async () => {
      config = createTestConfig({
        session: { maxSessions: 2, idleTimeoutMs: 600000 },
      });
      manager = new SessionManager(config);

      await manager.getOrCreate('conv-1');
      await manager.getOrCreate('conv-2');

      await expect(manager.getOrCreate('conv-3')).rejects.toThrow(MaxSessionsError);
    });

    it('should update lastActivityAt on access', async () => {
      const session = await manager.getOrCreate('conv-1');
      const firstAccess = session.lastActivityAt;

      // Wait a bit and access again
      await new Promise((resolve) => setTimeout(resolve, 10));
      await manager.getOrCreate('conv-1');

      expect(session.lastActivityAt).toBeGreaterThan(firstAccess);
    });
  });

  describe('get', () => {
    it('should return existing session', async () => {
      await manager.getOrCreate('conv-1');
      const session = manager.get('conv-1');

      expect(session.conversationId).toBe('conv-1');
    });

    it('should throw SessionNotFoundError for non-existent session', () => {
      expect(() => manager.get('non-existent')).toThrow(SessionNotFoundError);
    });
  });

  describe('has', () => {
    it('should return true for existing session', async () => {
      await manager.getOrCreate('conv-1');
      expect(manager.has('conv-1')).toBe(true);
    });

    it('should return false for non-existent session', () => {
      expect(manager.has('non-existent')).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should remove session', async () => {
      await manager.getOrCreate('conv-1');
      expect(manager.has('conv-1')).toBe(true);

      await manager.destroy('conv-1');
      expect(manager.has('conv-1')).toBe(false);
      expect(manager.size).toBe(0);
    });

    it('should not throw for non-existent session', async () => {
      await expect(manager.destroy('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('shutdown', () => {
    it('should destroy all sessions', async () => {
      await manager.getOrCreate('conv-1');
      await manager.getOrCreate('conv-2');
      await manager.getOrCreate('conv-3');

      expect(manager.size).toBe(3);

      await manager.shutdown();

      expect(manager.size).toBe(0);
    });
  });

  describe('listSessions', () => {
    it('should return metadata for all sessions', async () => {
      await manager.getOrCreate('conv-1');
      await manager.getOrCreate('conv-2');

      const sessions = manager.listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.conversationId).sort()).toEqual(['conv-1', 'conv-2']);
    });
  });

  describe('findIdleSessions', () => {
    it('should return sessions that exceed idle timeout', async () => {
      // Use very short timeout for testing
      config = createTestConfig({
        session: { maxSessions: 5, idleTimeoutMs: 50 },
      });
      manager = new SessionManager(config);

      await manager.getOrCreate('conv-1');

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 100));

      const idleSessions = manager.findIdleSessions();
      expect(idleSessions).toContain('conv-1');
    });

    it('should not return recently active sessions', async () => {
      config = createTestConfig({
        session: { maxSessions: 5, idleTimeoutMs: 60000 },
      });
      manager = new SessionManager(config);

      await manager.getOrCreate('conv-1');

      const idleSessions = manager.findIdleSessions();
      expect(idleSessions).not.toContain('conv-1');
    });
  });

  describe('concurrency', () => {
    it('should handle concurrent getOrCreate for same conversation', async () => {
      const promises = Array.from({ length: 10 }, () => manager.getOrCreate('conv-1'));

      const sessions = await Promise.all(promises);

      // All should return the same session
      const firstSession = sessions[0];
      expect(sessions.every((s) => s === firstSession)).toBe(true);
      expect(manager.size).toBe(1);
    });
  });
});
