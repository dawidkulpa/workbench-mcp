/**
 * Sandbox container operations.
 * Handles container lifecycle: create, start, exec, destroy.
 */
import type Dockerode from 'dockerode';
import { DockerError, ExecTimeoutError } from '../errors.js';
import type { DockerClient } from './client.js';
import {
  CONTAINER_TYPES,
  type SandboxCreateOptions,
  type SandboxContainer,
  type ExecOptions,
  type ExecResult,
  type FileEntry,
} from './types.js';
import { readFileInContainer, writeFileInContainer, listDirInContainer } from './fs.js';

const SANDBOX_NAME_PREFIX = 'workbench-sandbox-';
const WORKSPACE_PATH = '/workspace';
const TOOLBELT_PATH = '/toolbelt';

/**
 * Parse memory limit string to bytes.
 * Supports formats like "512m", "1g", "1024k"
 */
function parseMemoryLimit(memLimit: string): number {
  const match = memLimit.match(/^(\d+)([kmg])?$/i);
  if (!match || !match[1]) {
    throw new Error(`Invalid memory limit format: ${memLimit}`);
  }

  const value = parseInt(match[1], 10);
  const unit = (match[2] ?? '').toLowerCase();

  switch (unit) {
    case 'k':
      return value * 1024;
    case 'm':
      return value * 1024 * 1024;
    case 'g':
      return value * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

/**
 * Create and start a sandbox container.
 */
export async function createSandbox(
  dockerClient: DockerClient,
  options: SandboxCreateOptions,
): Promise<SandboxContainer> {
  const containerName = `${SANDBOX_NAME_PREFIX}${options.conversationId}`;

  // Build mount configuration
  const binds: string[] = [];
  if (options.toolbeltHostPath) {
    binds.push(`${options.toolbeltHostPath}:${TOOLBELT_PATH}:ro`);
  }

  // Create container configuration
  const createOptions: Dockerode.ContainerCreateOptions = {
    name: containerName,
    Image: options.image,
    Hostname: 'sandbox',
    WorkingDir: WORKSPACE_PATH,
    Tty: false,
    OpenStdin: false,
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    HostConfig: {
      NetworkMode: options.networkId,
      Binds: binds.length > 0 ? binds : undefined,
      // Resource limits
      NanoCpus: Math.floor(options.cpuLimit * 1e9),
      Memory: parseMemoryLimit(options.memoryLimit),
      // Security hardening
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      ReadonlyRootfs: false, // Need writable /workspace
      // Keep container running
      AutoRemove: false,
    },
    // Keep container running with a simple command
    Cmd: ['tail', '-f', '/dev/null'],
  };

  // Create the container
  const container = await dockerClient.createContainer(
    createOptions,
    options.conversationId,
    CONTAINER_TYPES.SANDBOX,
  );

  // Start the container
  try {
    await container.start();
  } catch (error) {
    // Clean up container if start fails
    try {
      await container.remove({ force: true });
    } catch {
      // Ignore cleanup errors
    }
    const err = error instanceof Error ? error : new Error(String(error));
    throw new DockerError('Failed to start sandbox container', err);
  }

  // Return wrapper object
  return createSandboxWrapper(dockerClient, container, options.conversationId);
}

/**
 * Create a wrapper for an existing sandbox container.
 */
function createSandboxWrapper(
  _dockerClient: DockerClient,
  container: Dockerode.Container,
  conversationId: string,
): SandboxContainer {
  return {
    containerId: container.id,
    container,

    async exec(options: ExecOptions): Promise<ExecResult> {
      return execInContainer(container, options);
    },

    async readFile(path: string): Promise<string> {
      return readFileInContainer(container, path);
    },

    async writeFile(path: string, content: string): Promise<void> {
      return writeFileInContainer(container, path, content);
    },

    async listDir(path: string): Promise<FileEntry[]> {
      return listDirInContainer(container, path);
    },

    async destroy(): Promise<void> {
      try {
        await container.stop({ t: 5 });
      } catch {
        // Container might already be stopped
      }
      try {
        await container.remove({ force: true });
      } catch (error) {
        // Ignore 404 (not found) and 409 (removal in progress) errors
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 409) {
          return;
        }
        const err = error instanceof Error ? error : new Error(String(error));
        throw new DockerError(`Failed to destroy sandbox: ${conversationId}`, err);
      }
    },
  };
}

/**
 * Execute a command in a container.
 */
async function execInContainer(
  container: Dockerode.Container,
  options: ExecOptions,
): Promise<ExecResult> {
  const { command, args = [], cwd = WORKSPACE_PATH, timeoutMs } = options;

  // Build the full command
  const fullCommand = [command, ...args];

  // Create exec instance
  const exec = await container.exec({
    Cmd: fullCommand,
    WorkingDir: cwd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });

  // Start exec and capture output
  const stream = await exec.start({ hijack: true, stdin: false });

  // Collect all data with optional timeout
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs) {
      timeoutHandle = setTimeout(() => {
        stream.destroy();
        reject(new ExecTimeoutError(timeoutMs));
      }, timeoutMs);
    }

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve();
    });

    stream.on('error', (error: Error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(new DockerError('Exec stream error', error));
    });
  });

  // Demultiplex the stream
  const { stdout, stderr } = demuxStream(Buffer.concat(chunks));

  // Get exit code
  const inspectResult = await exec.inspect();
  const exitCode = inspectResult.ExitCode ?? 0;

  return { stdout, stderr, exitCode };
}

/**
 * Demultiplex Docker exec stream.
 * Docker uses an 8-byte header: [type, 0, 0, 0, size1, size2, size3, size4]
 * type: 0=stdin, 1=stdout, 2=stderr
 */
function demuxStream(buffer: Buffer): { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;

    const type = buffer[offset];
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + size > buffer.length) break;

    const data = buffer.subarray(offset, offset + size).toString('utf8');
    offset += size;

    if (type === 1) {
      stdout += data;
    } else if (type === 2) {
      stderr += data;
    }
  }

  return { stdout, stderr };
}

/**
 * Get sandbox container name from conversation ID.
 */
export function getSandboxName(conversationId: string): string {
  return `${SANDBOX_NAME_PREFIX}${conversationId}`;
}

/**
 * Wait for container to be running.
 */
export async function waitForContainer(
  container: Dockerode.Container,
  timeoutMs: number = 10000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const info = await container.inspect();
      if (info.State.Running) {
        return;
      }
    } catch {
      // Container might not exist yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new DockerError('Container did not start in time', undefined);
}
