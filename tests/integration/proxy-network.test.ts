import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  DockerClient,
  createSandbox,
  createProxy,
  createSessionNetwork,
} from '../../src/docker/index.js';

/**
 * Integration tests for proxy and network isolation.
 *
 * Prerequisites:
 * - Docker Engine running
 * - Images built:
 *   - docker build -t workbench-sandbox:test ./containers/sandbox
 *   - docker build -t workbench-proxy:test ./containers/proxy
 *
 * Run with: RUN_INTEGRATION_TESTS=1 npm run test:integration
 */
describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)('Proxy & Network Integration', () => {
  let dockerClient: DockerClient;
  const SANDBOX_IMAGE = 'workbench-sandbox:test';
  const PROXY_IMAGE = 'workbench-proxy:test';

  // Increase timeout for Docker operations
  const DOCKER_TIMEOUT = 30000;

  beforeAll(async () => {
    dockerClient = new DockerClient();

    // Verify Docker is available
    const isAvailable = await dockerClient.ping();
    if (!isAvailable) {
      throw new Error('Docker is not available. Please start Docker Engine.');
    }

    // Cleanup any orphaned resources from previous runs
    await dockerClient.cleanupOrphans();

    // Verify images exist
    const sandboxExists = await dockerClient.imageExists(SANDBOX_IMAGE);
    if (!sandboxExists) {
      throw new Error(
        `Sandbox image ${SANDBOX_IMAGE} not found. Build it with: docker build -t ${SANDBOX_IMAGE} ./containers/sandbox`,
      );
    }

    const proxyExists = await dockerClient.imageExists(PROXY_IMAGE);
    if (!proxyExists) {
      throw new Error(
        `Proxy image ${PROXY_IMAGE} not found. Build it with: docker build -t ${PROXY_IMAGE} ./containers/proxy`,
      );
    }
  }, DOCKER_TIMEOUT);

  afterAll(async () => {
    // Cleanup any orphaned resources
    await dockerClient.cleanupOrphans();
  }, DOCKER_TIMEOUT);

  describe('Proxy Container Lifecycle', () => {
    it(
      'should create and start a proxy container',
      async () => {
        const network = await createSessionNetwork(dockerClient, {
          conversationId: 'test-proxy-create',
        });

        let proxy: Awaited<ReturnType<typeof createProxy>> | undefined;

        try {
          proxy = await createProxy(dockerClient, {
            conversationId: 'test-proxy-create',
            image: PROXY_IMAGE,
            networkId: network.id,
            allowlist: ['httpbin.org'],
          });

          expect(proxy.containerId).toBeDefined();

          // Verify container is running
          const info = await proxy.container.inspect();
          expect(info.State.Running).toBe(true);
        } finally {
          if (proxy) await proxy.destroy();
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );

    it(
      'should configure allowlist via environment',
      async () => {
        const network = await createSessionNetwork(dockerClient, {
          conversationId: 'test-proxy-env',
        });

        let proxy: Awaited<ReturnType<typeof createProxy>> | undefined;

        try {
          proxy = await createProxy(dockerClient, {
            conversationId: 'test-proxy-env',
            image: PROXY_IMAGE,
            networkId: network.id,
            allowlist: ['api.example.com', '*.test.com'],
          });

          const info = await proxy.container.inspect();
          const envVars = info.Config.Env ?? [];

          const allowlistEnv = envVars.find((e: string) => e.startsWith('PROXY_ALLOWLIST='));
          expect(allowlistEnv).toBe('PROXY_ALLOWLIST=api.example.com,*.test.com');
        } finally {
          if (proxy) await proxy.destroy();
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );
  });

  describe('Network Isolation', () => {
    it(
      'should create internal network with no external access',
      async () => {
        const network = await createSessionNetwork(dockerClient, {
          conversationId: 'test-isolation',
        });

        try {
          const info = await network.network.inspect();

          // Network should be internal (no external access)
          expect(info.Internal).toBe(true);
        } finally {
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );

    it(
      'should verify sandbox cannot access external internet directly',
      async () => {
        const network = await createSessionNetwork(dockerClient, {
          conversationId: 'test-no-internet',
        });

        let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;

        try {
          sandbox = await createSandbox(dockerClient, {
            conversationId: 'test-no-internet',
            image: SANDBOX_IMAGE,
            networkId: network.id,
            cpuLimit: 0.5,
            memoryLimit: '256m',
          });

          // Try to ping an external host - should fail due to internal network
          const result = await sandbox.exec({
            command: 'timeout',
            args: ['2', 'ping', '-c', '1', '8.8.8.8'],
            timeoutMs: 5000,
          });

          // Ping should fail (non-zero exit code)
          expect(result.exitCode).not.toBe(0);
        } finally {
          if (sandbox) await sandbox.destroy();
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );

    it(
      'should verify sandbox cannot resolve external DNS',
      async () => {
        const network = await createSessionNetwork(dockerClient, {
          conversationId: 'test-no-dns',
        });

        let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;

        try {
          sandbox = await createSandbox(dockerClient, {
            conversationId: 'test-no-dns',
            image: SANDBOX_IMAGE,
            networkId: network.id,
            cpuLimit: 0.5,
            memoryLimit: '256m',
          });

          // Try to resolve an external hostname - should fail
          const result = await sandbox.exec({
            command: 'timeout',
            args: ['2', 'nslookup', 'google.com'],
            timeoutMs: 5000,
          });

          // DNS lookup should fail
          expect(result.exitCode).not.toBe(0);
        } finally {
          if (sandbox) await sandbox.destroy();
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );
  });

  describe('Sandbox-Proxy Communication', () => {
    it(
      'should verify sandbox can reach proxy via hostname',
      async () => {
        const network = await createSessionNetwork(dockerClient, {
          conversationId: 'test-comm-hostname',
        });

        let proxy: Awaited<ReturnType<typeof createProxy>> | undefined;
        let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;

        try {
          proxy = await createProxy(dockerClient, {
            conversationId: 'test-comm-hostname',
            image: PROXY_IMAGE,
            networkId: network.id,
            allowlist: ['httpbin.org'],
          });

          sandbox = await createSandbox(dockerClient, {
            conversationId: 'test-comm-hostname',
            image: SANDBOX_IMAGE,
            networkId: network.id,
            cpuLimit: 0.5,
            memoryLimit: '256m',
          });

          // Check if sandbox can resolve proxy hostname using Node's DNS
          const result = await sandbox.exec({
            command: 'node',
            args: [
              '-e',
              `
              const dns = require('dns');
              dns.lookup('proxy', (err, address) => {
                if (err) {
                  console.error(err.message);
                  process.exit(1);
                }
                console.log(address);
              });
              `,
            ],
            timeoutMs: 10000,
          });

          // Should succeed if Docker DNS is working
          expect(result.exitCode).toBe(0);
          // Should return a valid IP address
          expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        } finally {
          if (sandbox) await sandbox.destroy();
          if (proxy) await proxy.destroy();
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );

    it(
      'should verify sandbox can connect to proxy health endpoint',
      async () => {
        const network = await createSessionNetwork(dockerClient, {
          conversationId: 'test-comm-health',
        });

        let proxy: Awaited<ReturnType<typeof createProxy>> | undefined;
        let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;

        try {
          proxy = await createProxy(dockerClient, {
            conversationId: 'test-comm-health',
            image: PROXY_IMAGE,
            networkId: network.id,
            allowlist: ['httpbin.org'],
          });

          sandbox = await createSandbox(dockerClient, {
            conversationId: 'test-comm-health',
            image: SANDBOX_IMAGE,
            networkId: network.id,
            cpuLimit: 0.5,
            memoryLimit: '256m',
          });

          // Try to connect to proxy health endpoint
          const result = await sandbox.exec({
            command: 'node',
            args: [
              '-e',
              `
              fetch('http://proxy:3128/health')
                .then(r => r.json())
                .then(data => console.log(JSON.stringify(data)))
                .catch(e => { console.error(e.message); process.exit(1); });
              `,
            ],
            timeoutMs: 10000,
          });

          expect(result.exitCode).toBe(0);
          const health: unknown = JSON.parse(result.stdout.trim());
          expect(
            typeof health === 'object' &&
              health !== null &&
              'status' in health &&
              health.status === 'ok',
          ).toBe(true);
        } finally {
          if (sandbox) await sandbox.destroy();
          if (proxy) await proxy.destroy();
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );
  });

  describe('Allowlist Enforcement', () => {
    it(
      'should verify proxy blocks requests to non-allowlisted URLs',
      async () => {
        const network = await createSessionNetwork(dockerClient, {
          conversationId: 'test-allowlist-block',
        });

        let proxy: Awaited<ReturnType<typeof createProxy>> | undefined;
        let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;

        try {
          proxy = await createProxy(dockerClient, {
            conversationId: 'test-allowlist-block',
            image: PROXY_IMAGE,
            networkId: network.id,
            allowlist: ['httpbin.org'],
          });

          sandbox = await createSandbox(dockerClient, {
            conversationId: 'test-allowlist-block',
            image: SANDBOX_IMAGE,
            networkId: network.id,
            cpuLimit: 0.5,
            memoryLimit: '256m',
          });

          const result = await sandbox.exec({
            command: 'node',
            args: [
              '-e',
              `
              fetch('http://proxy:3128', {
                headers: { 'X-Target-URL': 'https://google.com' }
              })
              .then(r => {
                console.log(r.status);
                return r.json();
              })
              .then(data => console.log(data.error))
              .catch(e => { console.error(e.message); process.exit(1); });
              `,
            ],
            timeoutMs: 10000,
          });

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('403');
          expect(result.stdout).toContain('not in allowlist');
        } finally {
          if (sandbox) await sandbox.destroy();
          if (proxy) await proxy.destroy();
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );

    it(
      'should verify proxy returns 400 for missing X-Target-URL',
      async () => {
        const network = await createSessionNetwork(dockerClient, {
          conversationId: 'test-allowlist-400',
        });

        let proxy: Awaited<ReturnType<typeof createProxy>> | undefined;
        let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;

        try {
          proxy = await createProxy(dockerClient, {
            conversationId: 'test-allowlist-400',
            image: PROXY_IMAGE,
            networkId: network.id,
            allowlist: ['httpbin.org'],
          });

          sandbox = await createSandbox(dockerClient, {
            conversationId: 'test-allowlist-400',
            image: SANDBOX_IMAGE,
            networkId: network.id,
            cpuLimit: 0.5,
            memoryLimit: '256m',
          });

          const result = await sandbox.exec({
            command: 'node',
            args: [
              '-e',
              `
              fetch('http://proxy:3128')
              .then(r => {
                console.log(r.status);
                return r.json();
              })
              .then(data => console.log(data.error))
              .catch(e => { console.error(e.message); process.exit(1); });
              `,
            ],
            timeoutMs: 10000,
          });

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('400');
        } finally {
          if (sandbox) await sandbox.destroy();
          if (proxy) await proxy.destroy();
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );
  });

  describe('Full Session with Proxy', () => {
    it(
      'should create complete session with sandbox, proxy, and network',
      async () => {
        const conversationId = 'test-full-session';

        // Create network
        const network = await createSessionNetwork(dockerClient, { conversationId });

        let proxy: Awaited<ReturnType<typeof createProxy>> | undefined;
        let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;

        try {
          // Create proxy
          proxy = await createProxy(dockerClient, {
            conversationId,
            image: PROXY_IMAGE,
            networkId: network.id,
            allowlist: ['httpbin.org', 'api.github.com'],
          });

          // Create sandbox
          sandbox = await createSandbox(dockerClient, {
            conversationId,
            image: SANDBOX_IMAGE,
            networkId: network.id,
            cpuLimit: 0.5,
            memoryLimit: '256m',
          });

          // Verify all components are running
          const sandboxInfo = await sandbox.container.inspect();
          const proxyInfo = await proxy.container.inspect();
          const networkInfo = await network.network.inspect();

          expect(sandboxInfo.State.Running).toBe(true);
          expect(proxyInfo.State.Running).toBe(true);
          expect(networkInfo.Internal).toBe(true);

          // Verify sandbox can execute code
          const execResult = await sandbox.exec({
            command: 'node',
            args: ['-e', 'console.log("Hello from sandbox")'],
          });
          expect(execResult.exitCode).toBe(0);
          expect(execResult.stdout.trim()).toBe('Hello from sandbox');
        } finally {
          // Cleanup in reverse order
          if (sandbox) await sandbox.destroy();
          if (proxy) await proxy.destroy();
          await network.destroy();
        }
      },
      DOCKER_TIMEOUT,
    );
  });
});
