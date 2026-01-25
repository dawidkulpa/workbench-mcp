import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DockerClient, createSandbox, createSessionNetwork } from '../../src/docker/index.js';

/**
 * Integration tests for session lifecycle.
 *
 * Prerequisites:
 * - Docker Engine running
 * - Sandbox image built: docker build -t workbench-sandbox:test ./containers/sandbox
 *
 * Run with: npm run test:integration
 */
describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)('Session Lifecycle Integration', () => {
  let dockerClient: DockerClient;
  const TEST_IMAGE = 'workbench-sandbox:test';

  beforeAll(async () => {
    dockerClient = new DockerClient();

    // Verify Docker is available
    const isAvailable = await dockerClient.ping();
    if (!isAvailable) {
      throw new Error('Docker is not available. Please start Docker Engine.');
    }

    // Verify test image exists
    const imageExists = await dockerClient.imageExists(TEST_IMAGE);
    if (!imageExists) {
      throw new Error(
        `Test image ${TEST_IMAGE} not found. Build it with: docker build -t ${TEST_IMAGE} ./containers/sandbox`,
      );
    }
  });

  afterAll(async () => {
    // Cleanup any orphaned resources
    await dockerClient.cleanupOrphans();
  });

  describe('Network Creation', () => {
    it('should create an isolated network', async () => {
      const network = await createSessionNetwork(dockerClient, {
        conversationId: 'test-network-1',
      });

      try {
        expect(network.id).toBeDefined();
        expect(network.name).toBe('workbench-test-network-1');

        // Verify network exists
        const info = await network.network.inspect();
        expect(info.Internal).toBe(true);
      } finally {
        await network.destroy();
      }
    });
  });

  describe('Sandbox Creation', () => {
    let network: Awaited<ReturnType<typeof createSessionNetwork>>;

    beforeEach(async () => {
      network = await createSessionNetwork(dockerClient, {
        conversationId: 'test-sandbox',
      });
    });

    afterEach(async () => {
      await network.destroy();
    });

    it('should create and start a sandbox container', async () => {
      const sandbox = await createSandbox(dockerClient, {
        conversationId: 'test-sandbox',
        image: TEST_IMAGE,
        networkId: network.id,
        cpuLimit: 0.5,
        memoryLimit: '256m',
      });

      try {
        expect(sandbox.containerId).toBeDefined();

        // Verify container is running
        const info = await sandbox.container.inspect();
        expect(info.State.Running).toBe(true);
      } finally {
        await sandbox.destroy();
      }
    });

    it('should execute commands in sandbox', async () => {
      const sandbox = await createSandbox(dockerClient, {
        conversationId: 'test-exec',
        image: TEST_IMAGE,
        networkId: network.id,
        cpuLimit: 0.5,
        memoryLimit: '256m',
      });

      try {
        const result = await sandbox.exec({
          command: 'echo',
          args: ['hello', 'world'],
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('hello world');
        expect(result.stderr).toBe('');
      } finally {
        await sandbox.destroy();
      }
    });

    it('should execute node in sandbox', async () => {
      const sandbox = await createSandbox(dockerClient, {
        conversationId: 'test-node',
        image: TEST_IMAGE,
        networkId: network.id,
        cpuLimit: 0.5,
        memoryLimit: '256m',
      });

      try {
        const result = await sandbox.exec({
          command: 'node',
          args: ['-e', 'console.log(1 + 1)'],
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('2');
      } finally {
        await sandbox.destroy();
      }
    });
  });

  describe('File System Operations', () => {
    let network: Awaited<ReturnType<typeof createSessionNetwork>>;
    let sandbox: Awaited<ReturnType<typeof createSandbox>>;

    beforeEach(async () => {
      network = await createSessionNetwork(dockerClient, {
        conversationId: 'test-fs',
      });

      sandbox = await createSandbox(dockerClient, {
        conversationId: 'test-fs',
        image: TEST_IMAGE,
        networkId: network.id,
        cpuLimit: 0.5,
        memoryLimit: '256m',
      });
    });

    afterEach(async () => {
      await sandbox.destroy();
      await network.destroy();
    });

    it('should write and read a file', async () => {
      const content = 'Hello, sandbox!';

      await sandbox.writeFile('test.txt', content);
      const readContent = await sandbox.readFile('test.txt');

      expect(readContent).toBe(content);
    });

    it('should write and read a TypeScript file', async () => {
      const code = `
export function add(a: number, b: number): number {
  return a + b;
}
      `.trim();

      await sandbox.writeFile('src/utils.ts', code);
      const readContent = await sandbox.readFile('src/utils.ts');

      expect(readContent).toBe(code);
    });

    it('should list directory contents', async () => {
      // Write some files
      await sandbox.writeFile('file1.txt', 'content1');
      await sandbox.writeFile('file2.txt', 'content2');

      const entries = await sandbox.listDir('/workspace');

      const names = entries.map((e) => e.name);
      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
    });

    it('should handle nested directories', async () => {
      await sandbox.writeFile('deep/nested/file.txt', 'deep content');

      const content = await sandbox.readFile('deep/nested/file.txt');
      expect(content).toBe('deep content');

      const entries = await sandbox.listDir('deep/nested');
      expect(entries.map((e) => e.name)).toContain('file.txt');
    });
  });

  describe('Cleanup', () => {
    it('should properly destroy sandbox and network', async () => {
      const network = await createSessionNetwork(dockerClient, {
        conversationId: 'test-cleanup',
      });

      const sandbox = await createSandbox(dockerClient, {
        conversationId: 'test-cleanup',
        image: TEST_IMAGE,
        networkId: network.id,
        cpuLimit: 0.5,
        memoryLimit: '256m',
      });

      const containerId = sandbox.containerId;
      const networkId = network.id;

      // Destroy
      await sandbox.destroy();
      await network.destroy();

      // Verify container is gone
      try {
        await dockerClient.getContainer(containerId).inspect();
        expect.fail('Container should have been removed');
      } catch {
        // Expected - container not found
      }

      // Verify network is gone
      try {
        await dockerClient.getNetwork(networkId).inspect();
        expect.fail('Network should have been removed');
      } catch {
        // Expected - network not found
      }
    });
  });
});
