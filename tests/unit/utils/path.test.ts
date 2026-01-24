import { describe, it, expect } from 'vitest';
import { validateWorkspacePath, getWorkspaceRoot } from '../../../src/utils/path.js';

describe('validateWorkspacePath', () => {
  it('should return workspace root for empty path', () => {
    expect(validateWorkspacePath('')).toBe('/workspace');
    expect(validateWorkspacePath('   ')).toBe('/workspace');
  });

  it('should accept relative paths within workspace', () => {
    expect(validateWorkspacePath('src/main.ts')).toBe('/workspace/src/main.ts');
    expect(validateWorkspacePath('package.json')).toBe('/workspace/package.json');
  });

  it('should accept workspace root explicitly', () => {
    expect(validateWorkspacePath('/workspace')).toBe('/workspace');
    expect(validateWorkspacePath('/workspace/')).toBe('/workspace');
  });

  it('should accept absolute paths within workspace', () => {
    expect(validateWorkspacePath('/workspace/src/main.ts')).toBe('/workspace/src/main.ts');
  });

  it('should normalize paths with . segments', () => {
    expect(validateWorkspacePath('./src/main.ts')).toBe('/workspace/src/main.ts');
    expect(validateWorkspacePath('src/./main.ts')).toBe('/workspace/src/main.ts');
  });

  it('should normalize paths with .. segments within workspace', () => {
    expect(validateWorkspacePath('src/../package.json')).toBe('/workspace/package.json');
    expect(validateWorkspacePath('./src/../src/main.ts')).toBe('/workspace/src/main.ts');
  });

  it('should reject path traversal attempts', () => {
    expect(() => validateWorkspacePath('../etc/passwd')).toThrow('Path must be within /workspace');
    expect(() => validateWorkspacePath('../../etc/passwd')).toThrow(
      'Path must be within /workspace',
    );
    expect(() => validateWorkspacePath('src/../../etc/passwd')).toThrow(
      'Path must be within /workspace',
    );
  });

  it('should reject absolute paths outside workspace', () => {
    expect(() => validateWorkspacePath('/etc/passwd')).toThrow('Path must be within /workspace');
    expect(() => validateWorkspacePath('/home/user/file.txt')).toThrow(
      'Path must be within /workspace',
    );
    expect(() => validateWorkspacePath('/tmp/test')).toThrow('Path must be within /workspace');
  });

  it('should reject paths that escape via traversal', () => {
    expect(() => validateWorkspacePath('/workspace/../etc/passwd')).toThrow(
      'Path must be within /workspace',
    );
  });

  it('should handle deeply nested paths', () => {
    expect(validateWorkspacePath('a/b/c/d/e/f.ts')).toBe('/workspace/a/b/c/d/e/f.ts');
  });
});

describe('getWorkspaceRoot', () => {
  it('should return /workspace', () => {
    expect(getWorkspaceRoot()).toBe('/workspace');
  });
});
