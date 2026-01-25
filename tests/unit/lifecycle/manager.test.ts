import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LifecycleManager, createLifecycleManager } from '../../../src/lifecycle/manager.js';
import { SessionManager } from '../../../src/session/manager.js';
import type { Config } from '../../../src/config/env.js';

// Mock the docker module
vi.mock('../../../src/docker/index.js', () => ({
  createDockerClient: vi.fn(() => ({
    cleanupOrphans: vi.fn().mockResolvedValue({ containers: 0, networks: 0 }),
  })),
}));

const createTestConfig = (): Config => ({
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
});

describe('LifecycleManager', () => {
  let manager: SessionManager;
  let lifecycle: LifecycleManager;
  let config: Config;

  beforeEach(() => {
    config = createTestConfig();
    manager = new SessionManager(config);
  });

  describe('startup', () => {
    it('should start the reaper', async () => {
      lifecycle = createLifecycleManager(manager, config);

      const result = await lifecycle.startup();

      expect(result.reaperStarted).toBe(true);
      expect(lifecycle.getReaper()?.running).toBe(true);

      lifecycle.shutdown();
    });

    it('should return orphan cleanup results', async () => {
      lifecycle = createLifecycleManager(manager, config);

      const result = await lifecycle.startup();

      expect(result.orphansRemoved).toEqual({ containers: 0, networks: 0 });

      lifecycle.shutdown();
    });

    it('should log startup events', async () => {
      const logger = {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      lifecycle = createLifecycleManager(manager, config, logger);

      await lifecycle.startup();

      // Reaper start is logged
      expect(logger.info).toHaveBeenCalled();

      lifecycle.shutdown();
    });
  });

  describe('shutdown', () => {
    it('should stop the reaper', async () => {
      lifecycle = createLifecycleManager(manager, config);

      await lifecycle.startup();
      expect(lifecycle.getReaper()?.running).toBe(true);

      lifecycle.shutdown();
      expect(lifecycle.getReaper()).toBeNull();
    });

    it('should be safe to call multiple times', async () => {
      lifecycle = createLifecycleManager(manager, config);

      await lifecycle.startup();
      lifecycle.shutdown();

      expect(() => lifecycle.shutdown()).not.toThrow();
    });
  });
});

describe('createLifecycleManager', () => {
  it('should create a lifecycle manager', () => {
    const config = createTestConfig();
    const manager = new SessionManager(config);

    const lifecycle = createLifecycleManager(manager, config);

    expect(lifecycle).toBeInstanceOf(LifecycleManager);
  });
});
