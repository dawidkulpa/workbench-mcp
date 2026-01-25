import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionReaper, createSessionReaper } from '../../../src/session/reaper.js';
import { SessionManager } from '../../../src/session/manager.js';
import type { Config } from '../../../src/config/env.js';

const createTestConfig = (overrides: Partial<Config> = {}): Config => ({
  server: {
    port: 3000,
    logLevel: 'info',
    apiToken: undefined,
  },
  session: {
    maxSessions: 5,
    idleTimeoutMs: 100, // 100ms for faster tests
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

describe('SessionReaper', () => {
  let manager: SessionManager;
  let reaper: SessionReaper;
  let config: Config;

  beforeEach(() => {
    vi.useFakeTimers();
    config = createTestConfig();
    manager = new SessionManager(config);
  });

  afterEach(() => {
    if (reaper) {
      reaper.stop();
    }
    vi.useRealTimers();
  });

  describe('start/stop', () => {
    it('should start and stop the reaper', () => {
      reaper = createSessionReaper(manager, { intervalMs: 1000 });

      expect(reaper.running).toBe(false);

      reaper.start();
      expect(reaper.running).toBe(true);

      reaper.stop();
      expect(reaper.running).toBe(false);
    });

    it('should not start twice', () => {
      reaper = createSessionReaper(manager, { intervalMs: 1000 });

      reaper.start();
      reaper.start(); // Should not throw or create duplicate timers

      expect(reaper.running).toBe(true);
    });

    it('should be safe to stop when not running', () => {
      reaper = createSessionReaper(manager, { intervalMs: 1000 });

      expect(() => reaper.stop()).not.toThrow();
    });
  });

  describe('reap', () => {
    it('should destroy idle sessions', async () => {
      reaper = createSessionReaper(manager, { intervalMs: 1000 });

      // Create sessions
      await manager.getOrCreate('conv-1');
      await manager.getOrCreate('conv-2');
      expect(manager.size).toBe(2);

      // Advance time past idle timeout
      vi.advanceTimersByTime(200); // 200ms > 100ms timeout

      // Manually trigger reap
      const destroyed = await reaper.reap();

      expect(destroyed).toBe(2);
      expect(manager.size).toBe(0);
    });

    it('should not destroy active sessions', async () => {
      reaper = createSessionReaper(manager, { intervalMs: 1000 });

      // Create session
      await manager.getOrCreate('conv-1');
      expect(manager.size).toBe(1);

      // Advance time but not past timeout
      vi.advanceTimersByTime(50); // 50ms < 100ms timeout

      // Touch session to keep it active
      manager.get('conv-1').touch();

      // Advance a bit more
      vi.advanceTimersByTime(50);

      // Manually trigger reap
      const destroyed = await reaper.reap();

      expect(destroyed).toBe(0);
      expect(manager.size).toBe(1);
    });

    it('should return 0 when no sessions', async () => {
      reaper = createSessionReaper(manager, { intervalMs: 1000 });

      const destroyed = await reaper.reap();

      expect(destroyed).toBe(0);
    });

    it('should log reap events when logger provided', async () => {
      const logger = {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      reaper = createSessionReaper(manager, { intervalMs: 1000, logger });

      await manager.getOrCreate('conv-1');
      vi.advanceTimersByTime(200);

      await reaper.reap();

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('automatic reaping', () => {
    it('should reap on interval', async () => {
      reaper = createSessionReaper(manager, { intervalMs: 100 });
      const reapSpy = vi.spyOn(reaper, 'reap');

      reaper.start();

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(150);

      expect(reapSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createSessionReaper', () => {
  it('should create reaper with default interval', () => {
    const config = createTestConfig();
    const manager = new SessionManager(config);

    const reaper = createSessionReaper(manager);

    expect(reaper).toBeInstanceOf(SessionReaper);
    expect(reaper.running).toBe(false);
  });

  it('should create reaper with custom interval', () => {
    const config = createTestConfig();
    const manager = new SessionManager(config);

    const reaper = createSessionReaper(manager, { intervalMs: 5000 });

    expect(reaper).toBeInstanceOf(SessionReaper);
  });
});
