import { describe, it, expect } from 'vitest';
import {
  SandboxExecInputSchema,
  SandboxFsReadInputSchema,
  SandboxFsWriteInputSchema,
  SandboxFsListInputSchema,
} from '../../../src/mcp/tools/schemas.js';

describe('Tool Schemas', () => {
  describe('SandboxExecInputSchema', () => {
    it('should accept valid exec input', () => {
      const input = {
        command: 'node',
        args: ['dist/main.js'],
        cwd: '/workspace/project',
        timeoutMs: 30000,
      };

      const result = SandboxExecInputSchema.parse(input);

      expect(result.command).toBe('node');
      expect(result.args).toEqual(['dist/main.js']);
      expect(result.cwd).toBe('/workspace/project');
      expect(result.timeoutMs).toBe(30000);
    });

    it('should provide default values', () => {
      const input = { command: 'ls' };

      const result = SandboxExecInputSchema.parse(input);

      expect(result.command).toBe('ls');
      expect(result.args).toEqual([]);
      expect(result.cwd).toBe('/workspace');
      expect(result.timeoutMs).toBeUndefined();
    });

    it('should reject empty command', () => {
      expect(() => SandboxExecInputSchema.parse({ command: '' })).toThrow();
    });

    it('should reject missing command', () => {
      expect(() => SandboxExecInputSchema.parse({})).toThrow();
    });
  });

  describe('SandboxFsReadInputSchema', () => {
    it('should accept valid path', () => {
      const result = SandboxFsReadInputSchema.parse({ path: 'src/main.ts' });
      expect(result.path).toBe('src/main.ts');
    });

    it('should reject empty path', () => {
      expect(() => SandboxFsReadInputSchema.parse({ path: '' })).toThrow();
    });

    it('should reject missing path', () => {
      expect(() => SandboxFsReadInputSchema.parse({})).toThrow();
    });
  });

  describe('SandboxFsWriteInputSchema', () => {
    it('should accept valid write input', () => {
      const input = {
        path: 'src/main.ts',
        content: 'console.log("hello");',
      };

      const result = SandboxFsWriteInputSchema.parse(input);

      expect(result.path).toBe('src/main.ts');
      expect(result.content).toBe('console.log("hello");');
    });

    it('should accept empty content', () => {
      const result = SandboxFsWriteInputSchema.parse({ path: 'empty.txt', content: '' });
      expect(result.content).toBe('');
    });

    it('should reject missing content', () => {
      expect(() => SandboxFsWriteInputSchema.parse({ path: 'file.txt' })).toThrow();
    });
  });

  describe('SandboxFsListInputSchema', () => {
    it('should accept path', () => {
      const result = SandboxFsListInputSchema.parse({ path: 'src' });
      expect(result.path).toBe('src');
    });

    it('should provide default path', () => {
      const result = SandboxFsListInputSchema.parse({});
      expect(result.path).toBe('/workspace');
    });
  });
});
