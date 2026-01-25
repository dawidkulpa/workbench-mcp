import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DockerClient, createSandbox, createSessionNetwork } from '../../src/docker/index.js';
import { SessionManager, DockerSessionFactory } from '../../src/session/manager.js';
import { createSessionReaper } from '../../src/session/reaper.js';
import { createLifecycleManager } from '../../src/lifecycle/index.js';
import { MaxSessionsError } from '../../src/errors.js';
import type { Config } from '../../src/config/env.js';

/**
 * Integration tests for Phase 4: Lifecycle & Cleanup.
 *
 * Prerequisites:
 * - Docker Engine running
 * - Sandbox and proxy images built
 *
 * Run with: RUN_INTEGRATION_TESTS=true npm run test:integration
 *
 * Note: These tests run sequentially to avoid Docker resource conflicts.
 */
describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)(
  'Lifecycle Integration',
  { sequential: true },
  () => {
    let dockerClient: DockerClient;
    const SANDBOX_IMAGE = 'workbench-sandbox:test';
    const PROXY_IMAGE = 'workbench-proxy:test';

    const createTestConfig = (overrides: Partial<Config> = {}): Config => ({
      server: {
        port: 3000,
        logLevel: 'info',
        apiToken: undefined,
      },
      session: {
        maxSessions: 5,
        idleTimeoutMs: 500, // 500ms for faster tests
        ...overrides.session,
      },
      docker: {
        sandboxImage: SANDBOX_IMAGE,
        proxyImage: PROXY_IMAGE,
        toolbeltHostPath: undefined,
        sandboxCpu: 0.5,
        sandboxMem: '256m',
        execTimeoutMs: 60000,
        ...overrides.docker,
      },
      proxy: {
        allowlist: [],
        ...overrides.proxy,
      },
      audit: {
        logPath: './audit.jsonl',
        verbose: false,
        ...overrides.audit,
      },
      env: 'test',
      ...overrides,
    });

    beforeAll(async () => {
      dockerClient = new DockerClient();

      // Verify Docker is available
      const isAvailable = await dockerClient.ping();
      if (!isAvailable) {
        throw new Error('Docker is not available. Please start Docker Engine.');
      }

      // Verify test images exist
      const sandboxExists = await dockerClient.imageExists(SANDBOX_IMAGE);
      const proxyExists = await dockerClient.imageExists(PROXY_IMAGE);
      if (!sandboxExists || !proxyExists) {
        throw new Error(
          `Test images not found. Build with: docker compose -f tests/integration/fixtures/docker-compose.test.yml build`,
        );
      }

      // Clean up any orphaned resources from previous test runs
      await dockerClient.cleanupOrphans();
    });

    afterAll(async () => {
      // Final cleanup
      await dockerClient.cleanupOrphans();
    });

    describe('Orphan Cleanup', () => {
      it('should clean up orphaned containers on startup', async () => {
        const testId = `orphan-${Date.now()}`;

        // Create some "orphaned" containers (simulate previous run)
        const network = await createSessionNetwork(dockerClient, {
          conversationId: testId,
        });

        await createSandbox(dockerClient, {
          conversationId: testId,
          image: SANDBOX_IMAGE,
          networkId: network.id,
          cpuLimit: 0.5,
          memoryLimit: '256m',
        });

        // Verify containers exist
        const containersBefore = await dockerClient.listManagedContainers();
        expect(containersBefore.some((c) => c.conversationId === testId)).toBe(true);

        // Run cleanup (simulating startup)
        const result = await dockerClient.cleanupOrphans();

        expect(result.containers).toBeGreaterThan(0);

        // Verify our container is gone
        const containersAfter = await dockerClient.listManagedContainers();
        expect(containersAfter.some((c) => c.conversationId === testId)).toBe(false);
      }, 30000); // 30 second timeout

      it('should integrate with LifecycleManager startup', async () => {
        const testId = `lifecycle-orphan-${Date.now()}`;

        // Create orphaned resources
        const network = await createSessionNetwork(dockerClient, {
          conversationId: testId,
        });

        await createSandbox(dockerClient, {
          conversationId: testId,
          image: SANDBOX_IMAGE,
          networkId: network.id,
          cpuLimit: 0.5,
          memoryLimit: '256m',
        });

        // Create lifecycle manager
        const config = createTestConfig();
        const sessionManager = new SessionManager(config, new DockerSessionFactory(dockerClient));
        const lifecycle = createLifecycleManager(sessionManager, config);

        try {
          // Run startup
          const result = await lifecycle.startup();

          expect(result.orphansRemoved.containers).toBeGreaterThan(0);
          expect(result.reaperStarted).toBe(true);

          // Verify our orphan was cleaned up
          const containers = await dockerClient.listManagedContainers();
          expect(containers.some((c) => c.conversationId === testId)).toBe(false);
        } finally {
          lifecycle.shutdown();
          await sessionManager.shutdown();
        }
      }, 30000); // 30 second timeout
    });

    describe('Idle Session Reaping', () => {
      it('should reap idle sessions with real containers', async () => {
        const testId = `reap-${Date.now()}`;
        const config = createTestConfig({
          session: {
            maxSessions: 5,
            idleTimeoutMs: 500, // 500ms idle timeout
          },
        });

        const sessionManager = new SessionManager(config, new DockerSessionFactory(dockerClient));
        const reaper = createSessionReaper(sessionManager, { intervalMs: 100 });

        try {
          // Create a session with real Docker containers
          await sessionManager.getOrCreate(testId);
          expect(sessionManager.size).toBe(1);

          // Verify container exists
          const containersBefore = await dockerClient.listManagedContainers();
          expect(containersBefore.some((c) => c.conversationId === testId)).toBe(true);

          // Wait for session to become idle
          await new Promise((resolve) => setTimeout(resolve, 600));

          // Manually trigger reap
          const reaped = await reaper.reap();
          expect(reaped).toBe(1);
          expect(sessionManager.size).toBe(0);

          // Verify container is gone
          const containersAfter = await dockerClient.listManagedContainers();
          expect(containersAfter.some((c) => c.conversationId === testId)).toBe(false);
        } finally {
          await sessionManager.shutdown();
          reaper.stop();
        }
      }, 60000); // 60 second timeout

      it('should not reap active sessions', async () => {
        const testId = `active-${Date.now()}`;
        const config = createTestConfig({
          session: {
            maxSessions: 5,
            idleTimeoutMs: 500,
          },
        });

        const sessionManager = new SessionManager(config, new DockerSessionFactory(dockerClient));
        const reaper = createSessionReaper(sessionManager, { intervalMs: 100 });

        try {
          // Create a session
          const session = await sessionManager.getOrCreate(testId);
          expect(sessionManager.size).toBe(1);

          // Keep touching it to keep it active
          await new Promise((resolve) => setTimeout(resolve, 300));
          session.touch();
          await new Promise((resolve) => setTimeout(resolve, 300));

          // Try to reap - should not reap active session
          const reaped = await reaper.reap();
          expect(reaped).toBe(0);
          expect(sessionManager.size).toBe(1);
        } finally {
          await sessionManager.shutdown();
          reaper.stop();
        }
      }, 60000); // 60 second timeout
    });

    describe('Resource Limits', () => {
      it('should apply CPU and memory limits to sandbox', async () => {
        const testId = `resource-${Date.now()}`;
        const network = await createSessionNetwork(dockerClient, {
          conversationId: testId,
        });

        try {
          const sandbox = await createSandbox(dockerClient, {
            conversationId: testId,
            image: SANDBOX_IMAGE,
            networkId: network.id,
            cpuLimit: 0.25, // 0.25 CPU
            memoryLimit: '128m', // 128MB
          });

          try {
            // Inspect container to verify limits
            const container = dockerClient.getContainer(sandbox.containerId);
            const info = await container.inspect();

            // Verify CPU limit (0.25 CPU = 0.25 * 1e9 NanoCpus)
            expect(info.HostConfig.NanoCpus).toBe(0.25 * 1e9);

            // Verify memory limit (128MB = 128 * 1024 * 1024 bytes)
            expect(info.HostConfig.Memory).toBe(128 * 1024 * 1024);
          } finally {
            await sandbox.destroy();
          }
        } finally {
          await network.destroy();
        }
      }, 30000); // 30 second timeout
    });

    describe('Max Sessions', () => {
      it('should reject new sessions when max reached', async () => {
        const testPrefix = `max-${Date.now()}`;
        const config = createTestConfig({
          session: {
            maxSessions: 2, // Only allow 2 sessions
            idleTimeoutMs: 600000,
          },
        });

        const sessionManager = new SessionManager(config, new DockerSessionFactory(dockerClient));

        try {
          // Create max sessions
          await sessionManager.getOrCreate(`${testPrefix}-1`);
          await sessionManager.getOrCreate(`${testPrefix}-2`);
          expect(sessionManager.size).toBe(2);

          // Try to create one more - should throw MaxSessionsError
          await expect(sessionManager.getOrCreate(`${testPrefix}-3`)).rejects.toThrow(
            MaxSessionsError,
          );

          // Verify only 2 sessions exist
          expect(sessionManager.size).toBe(2);
        } finally {
          await sessionManager.shutdown();
        }
      }, 60000); // 60 second timeout

      it('should allow new sessions after destroying one', async () => {
        const testPrefix = `replace-${Date.now()}`;
        const config = createTestConfig({
          session: {
            maxSessions: 2,
            idleTimeoutMs: 600000,
          },
        });

        const sessionManager = new SessionManager(config, new DockerSessionFactory(dockerClient));

        try {
          // Fill up sessions
          await sessionManager.getOrCreate(`${testPrefix}-1`);
          await sessionManager.getOrCreate(`${testPrefix}-2`);

          // Destroy one
          await sessionManager.destroy(`${testPrefix}-1`);
          expect(sessionManager.size).toBe(1);

          // Should now be able to create a new one
          const newSession = await sessionManager.getOrCreate(`${testPrefix}-3`);
          expect(newSession.conversationId).toBe(`${testPrefix}-3`);
          expect(sessionManager.size).toBe(2);
        } finally {
          await sessionManager.shutdown();
        }
      }, 90000); // 90 second timeout - creates 3 sessions total
    });
  },
);
