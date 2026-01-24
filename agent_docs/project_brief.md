# Project Brief (Persistent)

## Product Vision
**Workbench MCP** is a self-hosted MCP server that provides secure, stateful TypeScript sandbox sessions for LLM agents—enabling them to iteratively write/run code while accessing external systems only through host-mediated tools.

## Core Principles

### Security First
- **No secrets in sandbox**: API keys, tokens, credentials never enter containers
- **No internet access**: Sandbox containers cannot reach external networks
- **Host mediation**: All external actions go through Workbench server
- **Audit everything**: Log all tool calls and external access

### Ephemeral by Design
- Sessions are tied to `X-Conversation-Id` (1:1 mapping)
- Containers destroyed after idle timeout (default 10 min)
- No persistence across restarts—clean slate every time
- Orphaned containers cleaned up on startup

### Developer Experience
- Docker Compose single command startup
- Toolbelt with docs/examples mounted into sandbox
- Clear error messages for self-hosting debugging
- Minimal configuration required for first run

## Coding Conventions

### Architecture
```
Routes → Services → Docker/External
   ↓         ↓            ↓
 HTTP    Business     Side Effects
 Only     Logic
```

- **Routes/Handlers**: Parse request, validate, call service, format response
- **Services**: Pure business logic, no I/O concerns
- **Docker/External**: All side effects isolated here

### Type Safety
- TypeScript strict mode enabled
- No `any` type—use `unknown` with type guards
- Zod for all external input validation
- Explicit return types on all functions

### Error Handling
- Domain-specific error classes extending `WorkbenchError`
- Errors include: message, code, statusCode
- Log errors with context (conversationId, operation)
- Never expose internal details to clients

### Naming
- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Docker labels: `workbench.property`

### Dependency Management
- **Always pin exact versions** in `package.json` (no `^` or `~` prefixes)
- Example: `"zod": "3.24.1"` not `"zod": "^3.24.1"`
- Use `npm update <package>` explicitly when upgrading
- This ensures reproducible builds across all environments

## Quality Gates

### Pre-Commit Hooks
```bash
# Must pass before commit
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test:unit   # Vitest (unit only, fast)
```

### CI Pipeline (GitHub Actions)
```bash
# On every PR
npm run lint
npm run typecheck
npm run test:unit
npm run build

# Optional (takes longer)
npm run test:integration  # Requires Docker
```

### Code Review Checklist
- [ ] Types are explicit (no `any`)
- [ ] Input validated with Zod
- [ ] Errors are domain-specific
- [ ] No secrets in code or logs
- [ ] Tests cover happy path + error cases
- [ ] Documentation updated if needed

## Key Commands

```bash
# Development
npm run dev           # Start server with hot reload
npm run build         # Compile TypeScript
npm start             # Run compiled server

# Testing
npm test              # All tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests (Docker required)
npm run test:watch    # Watch mode

# Quality
npm run lint          # ESLint
npm run lint:fix      # ESLint with auto-fix
npm run typecheck     # TypeScript type check
npm run format        # Prettier

# Docker
docker compose up -d           # Start all services
docker compose logs -f         # Follow logs
docker compose down --volumes  # Clean shutdown
```

## Environment Setup

### Required
- Node.js 20 LTS
- Docker Engine
- VS Code with extensions:
  - ESLint
  - Prettier
  - TypeScript
  - Docker

### Optional
- Docker Desktop (for GUI)
- pino-pretty for dev logging

## Update Cadence

Update this brief when:
- Adding new conventions or patterns
- Changing quality gate requirements
- Adding new commands or workflows
- Modifying architecture boundaries
- After each major phase completion

## Quick Reference

| Question | Answer |
|----------|--------|
| Where do routes go? | `src/mcp/` |
| Where is business logic? | `src/session/`, `src/docker/` |
| Where are types? | Co-located with module or `types.ts` |
| Where are tests? | `tests/unit/`, `tests/integration/` |
| How to add a tool? | See `agent_docs/code_patterns.md` |
| How to add a toolbelt module? | `toolbelt/<tool-name>/` |
