# Code Patterns & Conventions

## TypeScript Conventions

### Strict Type Safety
```typescript
// ❌ NEVER use `any`
function processData(data: any) { ... }

// ✅ Use `unknown` with type guards
function processData(data: unknown): ProcessedData {
  if (!isValidInput(data)) {
    throw new InvalidInputError('Invalid data format');
  }
  return transform(data);
}

// ✅ Type guard example
function isValidInput(data: unknown): data is InputData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'id' in data &&
    typeof (data as InputData).id === 'string'
  );
}
```

### Zod for Runtime Validation
```typescript
import { z } from 'zod';

// Define schema
export const SandboxExecInputSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().optional().default('/workspace'),
  timeoutMs: z.number().positive().optional(),
});

export type SandboxExecInput = z.infer<typeof SandboxExecInputSchema>;

// Validate in handler
function handleExec(rawInput: unknown): SandboxExecOutput {
  const input = SandboxExecInputSchema.parse(rawInput);
  // input is now typed and validated
}
```

### Error Handling Pattern
```typescript
// Define domain errors
export class WorkbenchError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'WorkbenchError';
  }
}

export class SessionNotFoundError extends WorkbenchError {
  constructor(conversationId: string) {
    super(
      `Session not found for conversation: ${conversationId}`,
      'SESSION_NOT_FOUND',
      404,
    );
  }
}

export class MaxSessionsError extends WorkbenchError {
  constructor(maxSessions: number) {
    super(
      `Maximum sessions (${maxSessions}) reached`,
      'MAX_SESSIONS_REACHED',
      503,
    );
  }
}

// Use in handlers
async function getSession(conversationId: string): Promise<Session> {
  const session = sessions.get(conversationId);
  if (!session) {
    throw new SessionNotFoundError(conversationId);
  }
  return session;
}
```

### Result Pattern (Alternative to Exceptions)
```typescript
type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

async function createSession(
  conversationId: string,
): Promise<Result<Session, WorkbenchError>> {
  if (sessions.size >= config.maxSessions) {
    return { ok: false, error: new MaxSessionsError(config.maxSessions) };
  }
  
  const session = await buildSession(conversationId);
  return { ok: true, value: session };
}

// Usage
const result = await createSession(convId);
if (!result.ok) {
  return reply.status(result.error.statusCode).send({ error: result.error.message });
}
const session = result.value;
```

## Fastify Patterns

### Route Handler Structure
```typescript
// Routes only handle HTTP concerns
import { FastifyInstance } from 'fastify';
import { SessionManager } from '../session/manager';

export async function mcpRoutes(
  fastify: FastifyInstance,
  opts: { sessionManager: SessionManager },
) {
  const { sessionManager } = opts;

  fastify.post('/mcp', {
    schema: {
      headers: {
        type: 'object',
        required: ['x-conversation-id'],
        properties: {
          'x-conversation-id': { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const conversationId = request.headers['x-conversation-id'] as string;
      
      // Delegate to service
      const session = await sessionManager.getOrCreate(conversationId);
      const result = await session.handleRequest(request.body);
      
      return reply.send(result);
    },
  });
}
```

### Plugin Pattern
```typescript
import fp from 'fastify-plugin';
import { SessionManager } from './session/manager';

declare module 'fastify' {
  interface FastifyInstance {
    sessionManager: SessionManager;
  }
}

export const sessionPlugin = fp(async (fastify, opts) => {
  const manager = new SessionManager(opts.config);
  
  fastify.decorate('sessionManager', manager);
  
  fastify.addHook('onClose', async () => {
    await manager.shutdown();
  });
});
```

## Session Management Patterns

### Per-Conversation Mutex
```typescript
import { Mutex } from './utils/mutex';

class SessionManager {
  private sessions = new Map<string, Session>();
  private locks = new Map<string, Mutex>();

  async getOrCreate(conversationId: string): Promise<Session> {
    // Get or create mutex for this conversation
    let mutex = this.locks.get(conversationId);
    if (!mutex) {
      mutex = new Mutex();
      this.locks.set(conversationId, mutex);
    }

    // Acquire lock to prevent race conditions
    const release = await mutex.acquire();
    try {
      let session = this.sessions.get(conversationId);
      if (!session) {
        session = await this.createSession(conversationId);
        this.sessions.set(conversationId, session);
      }
      session.touch(); // Update lastActivityAt
      return session;
    } finally {
      release();
    }
  }
}
```

### Session Type Definition
```typescript
export interface Session {
  conversationId: string;
  createdAt: number;
  lastActivityAt: number;
  sandbox: {
    containerId: string;
  };
  proxy: {
    containerId: string;
  };
  network: {
    id: string;
    name: string;
  };
  touch(): void;
  destroy(): Promise<void>;
}
```

## Docker Patterns

### dockerode Wrapper
```typescript
import Docker from 'dockerode';

export class DockerClient {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async createContainer(opts: ContainerCreateOptions): Promise<string> {
    const container = await this.docker.createContainer({
      Image: opts.image,
      name: opts.name,
      Labels: {
        'workbench.mcp': 'true',
        'workbench.conversationId': opts.conversationId,
      },
      HostConfig: {
        Memory: opts.memoryLimit,
        NanoCpus: opts.cpuLimit * 1e9,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        Binds: opts.binds,
        NetworkMode: opts.networkId,
      },
      User: 'node',
    });
    
    await container.start();
    return container.id;
  }

  async execInContainer(
    containerId: string,
    command: string[],
    opts: ExecOptions,
  ): Promise<ExecResult> {
    const container = this.docker.getContainer(containerId);
    
    const exec = await container.exec({
      Cmd: command,
      WorkingDir: opts.cwd,
      AttachStdout: true,
      AttachStderr: true,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Exec timeout'));
      }, opts.timeoutMs);

      exec.start({ hijack: true, stdin: false }, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          return reject(err);
        }
        
        let stdout = '';
        let stderr = '';
        
        // Demux stdout/stderr
        container.modem.demuxStream(stream, 
          { write: (chunk: Buffer) => { stdout += chunk.toString(); } },
          { write: (chunk: Buffer) => { stderr += chunk.toString(); } },
        );

        stream.on('end', async () => {
          clearTimeout(timeout);
          const inspect = await exec.inspect();
          resolve({
            exitCode: inspect.ExitCode ?? -1,
            stdout,
            stderr,
          });
        });
      });
    });
  }
}
```

### File Operations via tar
```typescript
import { pack, extract } from 'tar-stream';
import { Readable, Writable } from 'stream';

export async function writeFile(
  containerId: string,
  path: string,
  content: string,
): Promise<void> {
  const container = docker.getContainer(containerId);
  
  const tarStream = pack();
  tarStream.entry({ name: basename(path) }, content);
  tarStream.finalize();

  await container.putArchive(tarStream, { path: dirname(path) });
}

export async function readFile(
  containerId: string,
  path: string,
): Promise<string> {
  const container = docker.getContainer(containerId);
  
  const stream = await container.getArchive({ path });
  
  return new Promise((resolve, reject) => {
    const extractor = extract();
    let content = '';
    
    extractor.on('entry', (header, stream, next) => {
      stream.on('data', (chunk) => { content += chunk.toString(); });
      stream.on('end', next);
    });
    
    extractor.on('finish', () => resolve(content));
    extractor.on('error', reject);
    
    stream.pipe(extractor);
  });
}
```

## Path Validation
```typescript
import path from 'path';

const WORKSPACE_ROOT = '/workspace';

export function validateWorkspacePath(inputPath: string): string {
  // Resolve to absolute path within workspace
  const resolved = path.resolve(WORKSPACE_ROOT, inputPath);
  
  // Ensure path is within workspace (prevent traversal)
  if (!resolved.startsWith(WORKSPACE_ROOT + path.sep) && resolved !== WORKSPACE_ROOT) {
    throw new WorkbenchError(
      'Path must be within /workspace',
      'INVALID_PATH',
      400,
    );
  }
  
  return resolved;
}
```

## Audit Logging Pattern
```typescript
import { createWriteStream, WriteStream } from 'fs';

interface AuditEvent {
  timestamp: string;
  type: string;
  conversationId: string;
  data: Record<string, unknown>;
}

export class AuditLogger {
  private stream: WriteStream;
  private verbose: boolean;

  constructor(path: string, verbose: boolean) {
    this.stream = createWriteStream(path, { flags: 'a' });
    this.verbose = verbose;
  }

  log(event: Omit<AuditEvent, 'timestamp'>): void {
    const entry: AuditEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    
    // Strip sensitive data unless verbose
    if (!this.verbose && 'body' in entry.data) {
      entry.data = { ...entry.data, body: '[REDACTED]' };
    }
    
    this.stream.write(JSON.stringify(entry) + '\n');
  }
}

// Usage
auditLogger.log({
  type: 'tool.exec',
  conversationId,
  data: {
    command: input.command,
    exitCode: result.exitCode,
    durationMs: Date.now() - startTime,
  },
});
```

## Naming Conventions

| Entity | Convention | Example |
|--------|------------|---------|
| Files | kebab-case | `session-manager.ts` |
| Classes | PascalCase | `SessionManager` |
| Functions | camelCase | `getOrCreate` |
| Constants | SCREAMING_SNAKE | `MAX_SESSIONS` |
| Types/Interfaces | PascalCase | `Session`, `ExecResult` |
| Zod Schemas | PascalCase + Schema | `SandboxExecInputSchema` |
| Docker Labels | dot.notation | `workbench.conversationId` |
| Env Vars | SCREAMING_SNAKE | `WORKBENCH_PORT` |

## Import Order
```typescript
// 1. Node built-ins
import path from 'path';
import { createWriteStream } from 'fs';

// 2. External packages
import { FastifyInstance } from 'fastify';
import Docker from 'dockerode';
import { z } from 'zod';

// 3. Internal modules (absolute)
import { SessionManager } from '@/session/manager';
import { DockerClient } from '@/docker/client';

// 4. Relative imports
import { validateWorkspacePath } from './path';
import type { Session } from './types';
```
