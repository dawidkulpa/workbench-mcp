import { z } from 'zod';

/**
 * Schema for sandbox.exec tool input.
 */
export const SandboxExecInputSchema = z.object({
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().optional().default('/workspace'),
  timeoutMs: z.number().positive().optional(),
});

export type SandboxExecInput = z.infer<typeof SandboxExecInputSchema>;

/**
 * Schema for sandbox.fs.read tool input.
 */
export const SandboxFsReadInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

export type SandboxFsReadInput = z.infer<typeof SandboxFsReadInputSchema>;

/**
 * Schema for sandbox.fs.write tool input.
 */
export const SandboxFsWriteInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  content: z.string(),
});

export type SandboxFsWriteInput = z.infer<typeof SandboxFsWriteInputSchema>;

/**
 * Schema for sandbox.fs.list tool input.
 */
export const SandboxFsListInputSchema = z.object({
  path: z.string().optional().default('/workspace'),
});

export type SandboxFsListInput = z.infer<typeof SandboxFsListInputSchema>;
