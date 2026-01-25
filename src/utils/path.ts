import path from 'path';
import { InvalidPathError } from '../errors.js';

const WORKSPACE_ROOT = '/workspace';

/**
 * Validate and normalize a path to ensure it's within the workspace.
 * Prevents path traversal attacks.
 *
 * @param inputPath - The path to validate (relative or absolute)
 * @returns The normalized absolute path within /workspace
 * @throws InvalidPathError if path escapes workspace
 */
export function validateWorkspacePath(inputPath: string): string {
  // Handle empty or whitespace-only paths
  if (!inputPath || inputPath.trim() === '') {
    return WORKSPACE_ROOT;
  }

  // Normalize the path to handle . and .. segments
  // Use POSIX path since we're inside a Linux container
  let normalized = path.posix.normalize(inputPath);

  // Remove trailing slashes (except for root)
  if (normalized.endsWith('/') && normalized !== '/') {
    normalized = normalized.slice(0, -1);
  }

  // Resolve to absolute path within workspace
  let resolved: string;
  if (path.posix.isAbsolute(normalized)) {
    resolved = normalized;
  } else {
    resolved = path.posix.resolve(WORKSPACE_ROOT, normalized);
  }

  // Ensure the resolved path is within workspace
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + '/')) {
    throw new InvalidPathError(`Path must be within ${WORKSPACE_ROOT}`);
  }

  return resolved;
}

/**
 * Get the workspace root constant.
 */
export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}
