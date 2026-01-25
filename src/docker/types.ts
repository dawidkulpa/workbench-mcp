/**
 * Docker-related type definitions.
 */
import type Dockerode from 'dockerode';

/**
 * Container creation options for sandbox.
 */
export interface SandboxCreateOptions {
  conversationId: string;
  image: string;
  networkId: string;
  cpuLimit: number;
  memoryLimit: string;
  toolbeltHostPath?: string;
}

/**
 * Container creation options for proxy sidecar.
 */
export interface ProxyCreateOptions {
  conversationId: string;
  image: string;
  networkId: string;
  allowlist: string[];
}

/**
 * Network creation options.
 */
export interface NetworkCreateOptions {
  conversationId: string;
}

/**
 * Result of command execution in sandbox.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Options for executing a command in sandbox.
 */
export interface ExecOptions {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

/**
 * File entry from directory listing.
 */
export interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modifiedAt: string;
}

/**
 * Container info for internal tracking.
 */
export interface ContainerInfo {
  id: string;
  name: string;
  conversationId: string;
}

/**
 * Network info for internal tracking.
 */
export interface NetworkInfo {
  id: string;
  name: string;
  conversationId: string;
}

/**
 * Sandbox container wrapper with operations.
 */
export interface SandboxContainer {
  containerId: string;
  container: Dockerode.Container;
  exec(options: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<FileEntry[]>;
  destroy(): Promise<void>;
}

/**
 * Proxy container wrapper.
 */
export interface ProxyContainer {
  containerId: string;
  container: Dockerode.Container;
  destroy(): Promise<void>;
}

/**
 * Docker network wrapper.
 */
export interface DockerNetwork {
  id: string;
  name: string;
  network: Dockerode.Network;
  destroy(): Promise<void>;
}

/**
 * Labels applied to workbench-managed containers.
 */
export const WORKBENCH_LABELS = {
  MANAGED: 'workbench.managed',
  CONVERSATION_ID: 'workbench.conversationId',
  CONTAINER_TYPE: 'workbench.containerType',
} as const;

/**
 * Container types for labeling.
 */
export const CONTAINER_TYPES = {
  SANDBOX: 'sandbox',
  PROXY: 'proxy',
} as const;
