# Essential Resources

## Official Documentation

| Resource | URL | Purpose |
|----------|-----|---------|
| MCP Protocol Spec | https://modelcontextprotocol.io | Understanding MCP transport, tools, resources |
| Fastify | https://fastify.dev/docs | HTTP framework reference |
| dockerode | https://github.com/apocas/dockerode | Docker SDK for Node.js |
| Zod | https://zod.dev | Schema validation |
| Vitest | https://vitest.dev | Testing framework |
| Docker Engine API | https://docs.docker.com/engine/api | Container operations |

## MCP Resources

### MCP Server Implementations
| Repository | Purpose |
|------------|---------|
| **modelcontextprotocol/servers** | Official MCP server examples |
| **anthropics/anthropic-cookbook** | MCP integration patterns |

### MCP Transport Reference
```typescript
// MCP Streamable HTTP basic structure
// Request: POST /mcp with JSON-RPC body
// Response: JSON-RPC response or SSE stream

interface MCPRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: string | number;
}

interface MCPResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string };
  id: string | number;
}
```

## Docker Security Best Practices

### Container Hardening
```yaml
# Recommended security settings for sandbox
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
read_only: true
user: node
tmpfs:
  - /tmp:size=100m
```

### Network Isolation
```yaml
# Per-session network (no external access)
networks:
  session-network:
    internal: true  # No default gateway
```

### Resource Limits
```yaml
deploy:
  resources:
    limits:
      cpus: '.5'
      memory: 512M
    reservations:
      memory: 256M
```

## TypeScript Best Practices

### Strict Configuration
```json
// tsconfig.json recommended settings
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### Error Handling Patterns
```typescript
// Domain errors with proper typing
class WorkbenchError extends Error {
  readonly code: string;
  readonly statusCode: number;
  
  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}
```

## Curated Repositories

### AI Coding Patterns
| Repository | Purpose |
|------------|---------|
| **PatrickJS/awesome-cursorrules** | Rule templates for AI assistants |
| **OneRedOak/claude-code-workflows** | Workflow patterns for Claude |
| **matebenyovszky/healing-agent** | Self-healing patterns |

### Security References
| Repository | Purpose |
|------------|---------|
| **OWASP/CheatSheetSeries** | Security best practices |
| **docker/docker-bench-security** | Container security checks |

## Homelab Integration References

### Home Assistant API
```typescript
// HA REST API patterns
const HA_API = 'http://homeassistant.local:8123/api';

// Get all states
GET /api/states
Authorization: Bearer <token>

// Call service
POST /api/services/{domain}/{service}
Authorization: Bearer <token>
Content-Type: application/json
{ "entity_id": "light.living_room" }
```

### Elasticsearch
```typescript
// Basic search
POST /{index}/_search
Content-Type: application/json
{
  "query": { "match_all": {} },
  "size": 10
}
```

## Development Tools

### VS Code Extensions
| Extension | ID | Purpose |
|-----------|-----|---------|
| ESLint | dbaeumer.vscode-eslint | Linting |
| Prettier | esbenp.prettier-vscode | Formatting |
| Docker | ms-azuretools.vscode-docker | Container management |
| REST Client | humao.rest-client | API testing |

### Debugging
```json
// .vscode/launch.json
{
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Server",
      "program": "${workspaceFolder}/src/index.ts",
      "runtimeArgs": ["-r", "tsx/cjs"],
      "console": "integratedTerminal"
    }
  ]
}
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| docker.sock permission denied | Add user to docker group or run with sudo |
| Container network unreachable | Check Docker network exists and is internal |
| Exec timeout | Increase `WORKBENCH_EXEC_TIMEOUT_MS` |
| Orphaned containers | Run cleanup: `docker rm -f $(docker ps -aq -f label=workbench.mcp=true)` |

### Debug Commands
```bash
# List workbench containers
docker ps -a -f label=workbench.mcp=true

# Inspect container
docker inspect <container-id>

# View container logs
docker logs <container-id>

# Check network connectivity
docker exec <container-id> ping -c 1 proxy

# Tail audit log
tail -f /data/audit.jsonl | jq
```
