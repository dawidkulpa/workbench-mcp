import { ZodError } from 'zod';
import type { Session } from '../../session/types.js';
import { WorkbenchError } from '../../errors.js';
import { validateWorkspacePath } from '../../utils/path.js';
import {
  SandboxExecInputSchema,
  SandboxFsReadInputSchema,
  SandboxFsWriteInputSchema,
  SandboxFsListInputSchema,
  type SandboxExecInput,
  type SandboxFsReadInput,
  type SandboxFsWriteInput,
  type SandboxFsListInput,
} from './schemas.js';

/**
 * MCP tool content item.
 */
interface ToolContent {
  type: 'text';
  text: string;
}

/**
 * MCP tool result.
 */
interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/**
 * Tool definition for MCP.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

/**
 * Tool handler function type.
 */
type ToolHandler = (session: Session, params: unknown) => Promise<ToolResult>;

/**
 * Tool registry with all available tools.
 */
class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();
  private definitions: ToolDefinition[] = [];

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.handlers.set(definition.name, handler);
    this.definitions.push(definition);
  }

  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  listTools(): ToolDefinition[] {
    return this.definitions;
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }
}

// Global tool registry
export const toolRegistry = new ToolRegistry();

/**
 * Execute a tool by name.
 */
export async function executeTool(
  name: string,
  session: Session,
  params: unknown,
): Promise<ToolResult> {
  const handler = toolRegistry.getHandler(name);
  if (!handler) {
    throw new WorkbenchError(`Tool not found: ${name}`, 'TOOL_NOT_FOUND', 404);
  }

  try {
    return await handler(session, params);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid parameters: ${error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
          },
        ],
        isError: true,
      };
    }

    if (error instanceof WorkbenchError) {
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Tool execution failed: ${message}` }],
      isError: true,
    };
  }
}

// ==================== Register Tools ====================

// sandbox.exec
toolRegistry.register(
  {
    name: 'sandbox.exec',
    description: 'Execute a command in the sandbox container',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments',
        },
        cwd: { type: 'string', description: 'Working directory (default: /workspace)' },
        timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds' },
      },
      required: ['command'],
    },
  },
  async (session: Session, params: unknown): Promise<ToolResult> => {
    const input: SandboxExecInput = SandboxExecInputSchema.parse(params);

    // Validate cwd is within workspace
    const cwd = validateWorkspacePath(input.cwd);

    const result = await session.sandbox.exec({
      command: input.command,
      args: input.args,
      cwd,
      ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
    });

    // Format output
    let output = '';
    if (result.stdout) {
      output += result.stdout;
    }
    if (result.stderr) {
      output += result.stderr;
    }
    output += `\n[Exit code: ${result.exitCode}]`;

    return {
      content: [{ type: 'text', text: output.trim() }],
      isError: result.exitCode !== 0,
    };
  },
);

// sandbox.fs.read
toolRegistry.register(
  {
    name: 'sandbox.fs.read',
    description: 'Read a file from the sandbox workspace',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file (relative to /workspace)' },
      },
      required: ['path'],
    },
  },
  async (session: Session, params: unknown): Promise<ToolResult> => {
    const input: SandboxFsReadInput = SandboxFsReadInputSchema.parse(params);

    const content = await session.sandbox.readFile(input.path);

    return {
      content: [{ type: 'text', text: content }],
    };
  },
);

// sandbox.fs.write
toolRegistry.register(
  {
    name: 'sandbox.fs.write',
    description: 'Write a file to the sandbox workspace',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file (relative to /workspace)' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
  },
  async (session: Session, params: unknown): Promise<ToolResult> => {
    const input: SandboxFsWriteInput = SandboxFsWriteInputSchema.parse(params);

    await session.sandbox.writeFile(input.path, input.content);

    return {
      content: [{ type: 'text', text: `File written: ${input.path}` }],
    };
  },
);

// sandbox.fs.list
toolRegistry.register(
  {
    name: 'sandbox.fs.list',
    description: 'List files in a directory in the sandbox workspace',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the directory (relative to /workspace, default: /workspace)',
        },
      },
    },
  },
  async (session: Session, params: unknown): Promise<ToolResult> => {
    const input: SandboxFsListInput = SandboxFsListInputSchema.parse(params);

    const entries = await session.sandbox.listDir(input.path);

    // Format as a simple listing
    const listing = entries
      .map((e) => {
        const icon = e.type === 'directory' ? '📁' : e.type === 'symlink' ? '🔗' : '📄';
        return `${icon} ${e.name}${e.type === 'directory' ? '/' : ''}`;
      })
      .join('\n');

    return {
      content: [{ type: 'text', text: listing || '(empty directory)' }],
    };
  },
);
