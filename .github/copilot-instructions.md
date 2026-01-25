# GitHub Copilot Instructions for Workbench MCP

## Project Context
**App:** Workbench MCP  
**Stack:** Node.js + TypeScript + Fastify + Docker (dockerode) + Vitest  
**Stage:** MVP Development  
**User Level:** Developer (experienced programmer)

## Directives

1. **Master Plan:** Always read `AGENTS.md` first. It contains the current phase, tasks, and architectural decisions.

2. **Documentation:** Refer to `agent_docs/` for detailed context:
   - `tech_stack.md` — Stack details, project structure, dependencies
   - `code_patterns.md` — Code style, examples, patterns to follow
   - `project_brief.md` — Conventions, quality gates, commands
   - `product_requirements.md` — User stories, acceptance criteria
   - `testing.md` — Test strategy, examples, CI pipeline

3. **Plan-First:** For non-trivial changes, propose a brief plan and wait for approval before coding.

4. **Incremental Build:** Implement one feature at a time. Test after each change.

5. **Pre-Commit:** Ensure these pass before committing:
   ```bash
   npm run lint
   npm run typecheck
   npm run test:unit
   ```

6. **No Linting in Chat:** Don't act as a linter. Use `npm run lint` for that.

7. **Communication:** Be concise. Ask clarifying questions when needed.

## Commands

```bash
# Development
npm run dev           # Start with hot reload
npm run build         # Compile TypeScript
npm start             # Run compiled

# Testing
npm test              # All tests
npm run test:unit     # Unit only (fast)
npm run test:watch    # Watch mode

# Quality
npm run lint          # ESLint
npm run lint:fix      # Auto-fix
npm run typecheck     # tsc --noEmit

# Docker
docker compose up -d  # Start services
docker compose down   # Stop services
```

## Type Safety Rules (Strict)

```typescript
// ❌ NEVER
function process(data: any) { ... }

// ✅ ALWAYS
function process(data: unknown): Result {
  const validated = Schema.parse(data);
  return transform(validated);
}
```

- **FORBIDDEN:** The `any` type
- **REQUIRED:** Explicit return types on all functions
- **REQUIRED:** Zod validation for all external inputs
- **REQUIRED:** Type guards for `unknown` types

## Architecture Rules

```
Routes → Services → Docker/External
   ↓         ↓            ↓
 HTTP    Business     Side Effects
 Only     Logic
```

- Route handlers: parse request, validate, call service, format response
- Business logic: goes in `src/session/` or `src/docker/`
- No database/Docker calls directly from route handlers

## Security Rules (Non-Negotiable)

- **NO secrets in sandbox containers** — ever
- **NO internet access from sandbox** — network is isolated
- **All external access via proxy** — with allowlist enforcement
- **Audit everything** — all tool calls must be logged

## What NOT To Do

- Do NOT delete files without explicit confirmation
- Do NOT modify Docker configurations without backup plan
- Do NOT add features not in the current phase (check AGENTS.md roadmap)
- Do NOT skip tests for "simple" changes
- Do NOT bypass failing tests or pre-commit hooks
- Do NOT use deprecated libraries or patterns
- Do NOT apologize for errors—fix them immediately
- Do NOT generate filler text before solutions

## Code Style Quick Reference

| Entity | Convention | Example |
|--------|------------|---------|
| Files | kebab-case | `session-manager.ts` |
| Classes | PascalCase | `SessionManager` |
| Functions | camelCase | `getOrCreate` |
| Constants | SCREAMING_SNAKE | `MAX_SESSIONS` |
| Types | PascalCase | `Session`, `ExecResult` |
| Docker labels | dot.notation | `workbench.conversationId` |

## Error Handling Pattern

```typescript
// Define domain errors
export class SessionNotFoundError extends WorkbenchError {
  constructor(conversationId: string) {
    super(
      `Session not found: ${conversationId}`,
      'SESSION_NOT_FOUND',
      404,
    );
  }
}

// Throw domain errors, catch at boundary
```

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point |
| `src/server.ts` | Fastify setup |
| `src/config/env.ts` | Environment config (Zod) |
| `src/session/manager.ts` | Session lifecycle |
| `src/docker/client.ts` | dockerode wrapper |
| `src/mcp/tools/` | MCP tool implementations |

## When Stuck

1. Check `AGENTS.md` for current phase and context
2. Check `agent_docs/code_patterns.md` for examples
3. Check `agent_docs/testing.md` for test patterns
4. Ask a specific clarifying question
