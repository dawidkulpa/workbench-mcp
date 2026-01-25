/**
 * File system operations for sandbox containers.
 * Implements read, write, list operations via docker exec.
 */
import type Dockerode from 'dockerode';
import { DockerError, InvalidPathError } from '../errors.js';
import { validateWorkspacePath } from '../utils/path.js';
import type { FileEntry } from './types.js';

/**
 * Read a file from the container.
 */
export async function readFileInContainer(
  container: Dockerode.Container,
  filePath: string,
): Promise<string> {
  // Validate path is within workspace
  const validatedPath = validateWorkspacePath(filePath);

  // Use cat to read the file
  const exec = await container.exec({
    Cmd: ['cat', validatedPath],
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });

  const stream = await exec.start({ hijack: true, stdin: false });
  const chunks: Buffer[] = [];

  // Collect all data
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  const buffer = Buffer.concat(chunks);
  const { stdout, stderr } = demuxStream(buffer);

  const inspectResult = await exec.inspect();
  const exitCode = inspectResult.ExitCode ?? 0;

  if (exitCode !== 0) {
    if (stderr.includes('No such file')) {
      throw new InvalidPathError(`File not found: ${validatedPath}`);
    }
    throw new DockerError(`Failed to read file: ${stderr.trim()}`, undefined);
  }

  return stdout;
}

/**
 * Write a file in the container.
 */
export async function writeFileInContainer(
  container: Dockerode.Container,
  filePath: string,
  content: string,
): Promise<void> {
  // Validate path is within workspace
  const validatedPath = validateWorkspacePath(filePath);

  // Create parent directory if needed
  const dirPath = validatedPath.substring(0, validatedPath.lastIndexOf('/'));
  if (dirPath && dirPath !== '/workspace') {
    const mkdirExec = await container.exec({
      Cmd: ['mkdir', '-p', dirPath],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const mkdirStream = await mkdirExec.start({ hijack: true, stdin: false });
    await waitForStreamEnd(mkdirStream);
  }

  // Use base64 encoding to safely transfer content
  const base64Content = Buffer.from(content, 'utf8').toString('base64');

  // Write using shell with base64 decode
  const exec = await container.exec({
    Cmd: ['sh', '-c', `echo '${base64Content}' | base64 -d > '${validatedPath}'`],
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });

  const stream = await exec.start({ hijack: true, stdin: false });
  const chunks: Buffer[] = [];

  // Collect all data
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  const buffer = Buffer.concat(chunks);
  const { stderr } = demuxStream(buffer);

  const inspectResult = await exec.inspect();
  const exitCode = inspectResult.ExitCode ?? 0;

  if (exitCode !== 0) {
    throw new DockerError(`Failed to write file: ${stderr.trim()}`, undefined);
  }
}

/**
 * List directory contents in the container.
 */
export async function listDirInContainer(
  container: Dockerode.Container,
  dirPath: string,
): Promise<FileEntry[]> {
  // Validate path is within workspace
  const validatedPath = validateWorkspacePath(dirPath);

  // Use ls with specific format for parsing
  const exec = await container.exec({
    Cmd: ['ls', '-la', '--time-style=iso', validatedPath],
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });

  const stream = await exec.start({ hijack: true, stdin: false });
  const chunks: Buffer[] = [];

  // Collect all data
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  const buffer = Buffer.concat(chunks);
  const { stdout, stderr } = demuxStream(buffer);

  const inspectResult = await exec.inspect();
  const exitCode = inspectResult.ExitCode ?? 0;

  if (exitCode !== 0) {
    if (stderr.includes('No such file')) {
      throw new InvalidPathError(`Directory not found: ${validatedPath}`);
    }
    throw new DockerError(`Failed to list directory: ${stderr.trim()}`, undefined);
  }

  return parseLsOutput(stdout);
}

/**
 * Parse ls -la output into FileEntry array.
 */
function parseLsOutput(output: string): FileEntry[] {
  const entries: FileEntry[] = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    // Skip header line (total ...)
    if (line.startsWith('total ')) continue;

    // Parse ls -la format:
    // -rw-r--r-- 1 node node 123 2024-01-15 10:30 filename
    // drwxr-xr-x 2 node node 4096 2024-01-15 10:30 dirname
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;

    const permissions = parts[0];
    const size = parseInt(parts[4] ?? '0', 10);
    const date = parts[5];
    const time = parts[6];
    // Name might contain spaces, so join the rest
    const name = parts.slice(7).join(' ');

    // Skip . and ..
    if (name === '.' || name === '..') continue;

    // Determine type from first character of permissions
    let type: FileEntry['type'];
    const typeChar = permissions?.charAt(0) ?? '-';
    switch (typeChar) {
      case 'd':
        type = 'directory';
        break;
      case 'l':
        type = 'symlink';
        break;
      case '-':
        type = 'file';
        break;
      default:
        type = 'other';
    }

    entries.push({
      name,
      type,
      size: isNaN(size) ? 0 : size,
      modifiedAt: `${date ?? ''}T${time ?? ''}`,
    });
  }

  return entries;
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
 * Wait for a stream to end.
 */
async function waitForStreamEnd(stream: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
    stream.resume(); // Drain the stream
  });
}
