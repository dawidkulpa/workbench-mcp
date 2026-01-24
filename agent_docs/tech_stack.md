# Tech Stack & Tools

## Core Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js | 20 LTS | Server runtime |
| Language | TypeScript | 5.x | Type-safe development |
| HTTP Framework | Fastify | 4.x | High-performance HTTP server |
| Docker SDK | dockerode | latest | Docker Engine API client |
| Validation | Zod | 3.x | Runtime schema validation |
| Logging | pino | 8.x | Structured logging |
| Testing | Vitest | 1.x | Unit and integration tests |

## Project Structure

```
workbench-mcp/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Fastify server setup
│   ├── config/
│   │   └── env.ts            # Environment configuration (Zod validated)
│   ├── mcp/
│   │   ├── transport.ts      # MCP Streamable HTTP transport
│   │   ├── tools/
│   │   │   ├── index.ts      # Tool registry
│   │   │   ├── sandbox-exec.ts
│   │   │   ├── sandbox-fs-read.ts
│   │   │   ├── sandbox-fs-write.ts
│   │   │   └── sandbox-fs-list.ts
│   │   └── schemas.ts        # Zod schemas for tool inputs/outputs
│   ├── session/
│   │   ├── manager.ts        # Session lifecycle management
│   │   ├── types.ts          # Session type definitions
│   │   └── reaper.ts         # Idle timeout cleanup
│   ├── docker/
│   │   ├── client.ts         # dockerode wrapper
│   │   ├── sandbox.ts        # Sandbox container operations
│   │   ├── proxy.ts          # Proxy sidecar operations
│   │   └── network.ts        # Network isolation
│   ├── audit/
│   │   └── logger.ts         # JSONL audit logging
│   └── utils/
│       ├── mutex.ts          # Per-conversation mutex
│       └── path.ts           # Path validation utilities
├── containers/
│   ├── sandbox/
│   │   ├── Dockerfile
│   │   └── template/         # Seeded workspace template
│   │       ├── package.json
│   │       ├── tsconfig.json
│   │       └── src/
│   │           └── main.ts
│   └── proxy/
│       ├── Dockerfile
│       └── src/
│           └── index.ts      # Allowlist-enforcing proxy
├── toolbelt/                 # Host-mounted read-only into sandbox
│   ├── http/
│   │   ├── index.ts
│   │   └── examples.md
│   └── README.md
├── tests/
│   ├── unit/
│   └── integration/
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .env.example
```

## Environment Variables

```bash
# Server
WORKBENCH_PORT=3000
WORKBENCH_LOG_LEVEL=info              # info | debug
WORKBENCH_API_TOKEN=                  # Optional; no auth if not provided
WORKBENCH_MAX_SESSIONS=5
WORKBENCH_IDLE_TIMEOUT_MIN=10
WORKBENCH_AUDIT_LOG_PATH=/data/audit.jsonl
WORKBENCH_AUDIT_VERBOSE=false

# Docker / Images
WORKBENCH_SANDBOX_IMAGE=workbench-sandbox:1.0
WORKBENCH_PROXY_IMAGE=workbench-proxy:1.0
WORKBENCH_TOOLBELT_HOST_PATH=/path/to/toolbelt
WORKBENCH_SANDBOX_CPU=.5
WORKBENCH_SANDBOX_MEM=512m
WORKBENCH_EXEC_TIMEOUT_MS=60000

# Proxy Allowlist
WORKBENCH_FETCH_ALLOWLIST=http://homeassistant.local:8123,http://192.168.10.16:9200
```

## Key Dependencies

```json
{
  "dependencies": {
    "fastify": "^4.x",
    "dockerode": "^4.x",
    "zod": "^3.x",
    "pino": "^8.x",
    "pino-pretty": "^10.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vitest": "^1.x",
    "@types/node": "^20.x",
    "@types/dockerode": "^3.x",
    "eslint": "^8.x",
    "@typescript-eslint/eslint-plugin": "^6.x",
    "@typescript-eslint/parser": "^6.x",
    "prettier": "^3.x",
    "husky": "^9.x",
    "lint-staged": "^15.x"
  }
}
```

## Setup Commands

```bash
# Initialize project
npm init -y
npm install fastify dockerode zod pino pino-pretty
npm install -D typescript vitest @types/node @types/dockerode \
  eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser \
  prettier husky lint-staged

# TypeScript config
npx tsc --init

# Run dev server
npm run dev

# Run tests
npm test

# Lint
npm run lint

# Type check
npm run typecheck

# Build
npm run build
```

## Docker Architecture

### Sandbox Container
- **Base:** `node:20-alpine`
- **User:** `node` (non-root)
- **Mounts:**
  - `/workspace` — writable, ephemeral
  - `/toolbelt` — read-only, host-mounted
- **Network:** Isolated per-session network only
- **Capabilities:** All dropped, `no-new-privileges`
- **Limits:** 0.5 CPU, 512MB RAM (configurable)

### Proxy Sidecar
- **Base:** `node:20-alpine`
- **Purpose:** Enforce allowlist for outbound HTTP
- **Networks:** 
  - Per-session internal (to serve sandbox)
  - Egress network (to reach LAN services)
- **No published ports**

### Networking Model
```
┌─────────────────────────────────────────┐
│  Per-Session Isolated Network           │
│  ┌──────────┐       ┌──────────┐        │
│  │ Sandbox  │──────→│  Proxy   │────────┼──→ Allowlisted LAN Services
│  │          │       │ Sidecar  │        │
│  └──────────┘       └──────────┘        │
│       ↑                                 │
│  No external                            │
│  network access                         │
└─────────────────────────────────────────┘
```

## Architectural Decisions (ADRs)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HTTP Framework | Fastify | Fast, great TS support, async I/O |
| Docker Control | dockerode | Structured API, avoids shell injection |
| Deployment | Container + docker.sock | Single `docker compose up` experience |
| Sandbox Networking | Per-session isolated network | Prevents cross-sandbox access |
| Proxy Auth | Network isolation only (MVP) | Simplest; add tokens later if needed |
| Toolbelt Mount | Host RO mount | Easy updates without rebuild |
| Audit Storage | In-memory + JSONL | Minimal deps; good enough for homelab |
| Client Auth | Disabled by default | Easiest first-run; LAN-first |
