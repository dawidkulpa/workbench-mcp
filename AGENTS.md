# AGENTS.md — Master Plan for Workbench MCP

## Project Overview
**App:** Workbench MCP  
**Goal:** A self-hosted MCP server that provides secure, stateful TypeScript sandbox sessions (Docker containers) for LLM agents—enabling iterative code execution with host-mediated external access.  
**Stack:** Node.js + TypeScript + Fastify + Docker (dockerode) + Vitest  
**Current Phase:** Phase 1 — Foundation

## How I Should Think
1. **Understand Intent First**: Before answering, identify what the user actually needs
2. **Ask If Unsure**: If critical information is missing, ask before proceeding
3. **Plan Before Coding**: Propose a plan, ask for approval, then implement
4. **Verify After Changes**: Run tests/linters or manual checks after each change
5. **Explain Trade-offs**: When recommending something, mention alternatives

## Plan → Execute → Verify
1. **Plan:** Outline a brief approach and ask for approval before coding.
2. **Execute:** Implement one feature at a time.
3. **Verify:** Run `npm test` and `npm run lint` after each feature; fix before moving on.

## Context & Memory
- Treat `AGENTS.md` and `agent_docs/` as living docs.
- Use `.github/copilot-instructions.md` for persistent project rules.
- Update these files as the project scales (commands, conventions, constraints).

## Testing & Verification
- Follow `agent_docs/testing.md` for test strategy.
- Unit tests with Vitest; integration tests require Docker.
- Do not move forward when verification fails.

## Checkpoints & Pre-Commit Hooks
- Create commits after milestones (each phase task completion).
- Ensure pre-commit hooks pass before commits (lint, typecheck, test).

## Context Files
Refer to these for details (load only when needed):
- `agent_docs/tech_stack.md`: Tech stack, libraries, and architecture decisions
- `agent_docs/code_patterns.md`: Code style, patterns, and examples
- `agent_docs/project_brief.md`: Persistent project rules and conventions
- `agent_docs/product_requirements.md`: Full PRD with user stories
- `agent_docs/testing.md`: Verification strategy and commands
- `agent_docs/resources.md`: External references and documentation

## Current State (Update This!)
**Last Updated:** 2026-01-25  
**Working On:** Phase 3 Complete  
**Recently Completed:** Phase 3 Proxy & Networking  
**Blocked By:** None

---

## Roadmap

### Phase 1: Foundation (Week 1) ✅
- [x] Initialize Node.js + TypeScript project with Fastify
- [x] Set up Vitest test harness
- [x] Configure ESLint + Prettier
- [x] Set up pre-commit hooks (husky + lint-staged)
- [x] Create basic MCP transport skeleton (Streamable HTTP)
- [x] Implement session map with concurrency locking
- [x] GitHub Actions CI baseline (lint + typecheck + unit tests)

### Phase 2: Docker Integration (Week 2) ✅
- [x] Implement Docker manager with dockerode
- [x] Create sandbox container lifecycle (create, start, destroy)
- [x] Implement workspace seeding from `/template`
- [x] Implement `sandbox.exec` tool with dockerode exec
- [x] Implement `sandbox.fs.read`, `sandbox.fs.write`, `sandbox.fs.list` tools
- [x] Integration test harness (docker-compose based)

### Phase 3: Proxy & Networking (Week 3) ✅
- [x] Create proxy sidecar container
- [x] Implement per-session isolated Docker network
- [x] Implement allowlist enforcement in proxy
- [x] Create SDK `fetch` helper for sandbox
- [x] Test: sandbox offline, proxy allowed

### Phase 4: Lifecycle & Cleanup (Week 4)
- [ ] Implement idle timeout reaper (default 10 min)
- [ ] Implement startup orphan cleanup
- [ ] Apply resource limits (CPU/RAM per sandbox)
- [ ] Implement max sessions (5) with rejection logic

### Phase 5: Observability & Hardening (Weeks 5-6)
- [ ] Implement JSONL audit logging
- [ ] Add verbosity modes (WORKBENCH_AUDIT_VERBOSE)
- [ ] Hardening pass (capabilities, read-only FS)
- [ ] Documentation: install, config, threat model
- [ ] Polish local dev flow
- [ ] Final integration tests

---

## Architecture Overview

```
LibreChat → MCP Streamable HTTP → Workbench MCP Server (Fastify)
                                        ↓
                                  Docker Engine API
                                        ↓
                    ┌───────────────────────────────────┐
                    │  Per-Conversation Session         │
                    │  ┌─────────────┐  ┌────────────┐  │
                    │  │  Sandbox    │←→│   Proxy    │  │
                    │  │  /workspace │  │  Sidecar   │  │
                    │  │  /toolbelt  │  │            │  │
                    │  └─────────────┘  └────────────┘  │
                    │        Isolated Docker Network    │
                    └───────────────────────────────────┘
```

---

## Key Invariants
- `X-Conversation-Id` header is **required** on every request
- One conversation → exactly one sandbox container at a time
- Sandbox has **no internet access** and **no secrets**
- External HTTP only via proxy sidecar with allowlist
- Max 5 concurrent sessions (reject with 503 when full)
- Idle timeout destroys session (default 10 minutes)

---

## MCP Tools (MVP)
| Tool | Description |
|------|-------------|
| `sandbox.exec` | Execute command in sandbox (e.g., `node dist/main.js`) |
| `sandbox.fs.read` | Read file from `/workspace` |
| `sandbox.fs.write` | Write file to `/workspace` |
| `sandbox.fs.list` | List directory contents in `/workspace` |

---

## What NOT To Do
- Do NOT delete files without explicit confirmation
- Do NOT modify Docker configurations without backup plan
- Do NOT add features not in the current phase
- Do NOT skip tests for "simple" changes
- Do NOT bypass failing tests or pre-commit hooks
- Do NOT use deprecated libraries or patterns
- Do NOT use `any` type—use `unknown` with type guards
- Do NOT put secrets in sandbox containers
- Do NOT allow sandbox direct network access

## Engineering Constraints

### Type Safety (No Compromises)
- The `any` type is FORBIDDEN—use `unknown` with type guards
- All function parameters and returns must be typed
- Use Zod for runtime validation of MCP inputs

### Architectural Sovereignty
- Route handlers handle request/response ONLY
- All business logic goes in `services/` or `core/`
- Docker operations isolated in `docker/` module

### Library Governance
- Check existing `package.json` before suggesting new dependencies
- Prefer native APIs over libraries (native fetch over axios)
- No deprecated patterns

### The "No Apologies" Rule
- Do NOT apologize for errors—fix them immediately
- Do NOT generate filler text before providing solutions
- If context is missing, ask ONE specific clarifying question

### Workflow Discipline
- Pre-commit hooks must pass before commits
- If verification fails, fix issues before continuing
