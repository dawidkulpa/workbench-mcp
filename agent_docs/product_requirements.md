# Product Requirements

## Executive Summary

**Product:** Workbench MCP  
**Version:** MVP (1.0)  
**One-liner:** A self-hosted MCP server that provides secure, stateful TypeScript sandbox sessions (Docker containers) for LLM agents—so they can iteratively write/run code, discover "toolbelt" APIs from prebaked project files, and access external systems only via host-mediated tools.

## Problem Statement

### Core Problem
- Agents need to: (1) iterate on code quickly, (2) handle large outputs (e.g., logs), and (3) safely take actions in a homelab.
- Direct tool calling can be chatty and context-heavy; raw outputs can be too large to send back verbatim.
- Running code is powerful but risky: secrets and network access must be tightly controlled.

### Desired Outcome
- An agent can do "code-mode" work inside a sandbox (read docs, write code, parse data) and only use external systems via audited, host-controlled tool calls.

## Target Audience

### Primary Persona
- Homelab operators using LibreChat
- Technically capable, security-conscious, wants reliable self-hosting

### Secondary Persona
- Open-source users who want a secure "agent sandbox + toolbelt" pattern they can host

### Jobs-to-be-done
- Provide a reusable, safe execution environment where agents can:
  - Iteratively write/execute TypeScript
  - Read a curated tool/API "toolbelt" and examples
  - Query/action homelab systems via host mediation
  - Reduce token/context costs by processing data locally

---

## User Stories (MVP)

| # | Story |
|---|-------|
| 1 | As a homelab operator, I want a stateful sandbox per chat conversation so an agent can iteratively write, run, and refine TypeScript code. |
| 2 | As a security-conscious admin, I want sandboxes to have no internet access and no secrets inside so compromise doesn't lead to credential exfiltration. |
| 3 | As an admin, I want to preload a "toolbelt" (docs/contracts/examples + optional helper code) into every sandbox so the agent can discover available tools without stuffing schemas into the model context. |
| 4 | As a user, I want the sandbox to be tied 1:1 to a LibreChat conversation using a required `X-Conversation-Id` header so it behaves predictably. |
| 5 | As a user, I want idle sessions to auto-destroy after a short timeout to reduce risk and resource usage. |

---

## MVP Scope (MoSCoW)

### Must Have (P0)

| Feature | Description |
|---------|-------------|
| Per-conversation stateful sandbox | 1:1 mapping: `X-Conversation-Id` → exactly one container at a time |
| Ephemeral by design | Container destroyed after inactivity; returning later recreates fresh sandbox |
| TypeScript-first execution | Run/iterate TS code inside the sandbox |
| Toolbelt inside sandbox | Directory tree of tools with contracts/examples + READMEs |
| Security | No API keys/secrets in sandbox; no general outbound network |
| Multi-session | Support up to 5 parallel sessions |
| Lifecycle management | Inactivity timeout default 10 minutes (configurable) |
| Deployability | Docker-first with example docker-compose |
| API access | Streamable HTTP with optional API token auth |

### Should Have (P1)

| Feature | Description |
|---------|-------------|
| Admin-friendly customization | Easy to edit/replace toolbelt contents (mount a folder) |
| Basic observability | Per-session logs + audit log of host-mediated tool calls |
| Resource controls | Limit CPU/memory per sandbox |

### Could Have (P2)

| Feature | Description |
|---------|-------------|
| Tool catalog UX | Index file for fast discovery |
| Per-tool policy controls | Allow/deny specific tool calls per deployment |
| Session debugging | Download workspace as zip, export logs |

### Won't Have (This Release)

| Feature | Reason |
|---------|--------|
| Persistent workspaces | By design—ephemeral sessions |
| Multi-language runtimes | TypeScript-first MVP |
| Web admin dashboard | Config + docker-compose sufficient |
| Horizontal scaling | Not needed for homelab |

---

## Functional Requirements

### 1. Session Identification & Lifecycle

**Requirement:** Every request must include `X-Conversation-Id`.

**Behavior:**
- If sandbox for conversation is running → reuse it
- If not running (new or timed out) → create new sandbox
- After inactivity timeout (default 10 min) → destroy sandbox

**Acceptance Criteria:**
- [ ] Missing `X-Conversation-Id` returns 400 error
- [ ] Idle sandboxes destroyed reliably
- [ ] No orphaned containers after cleanup

### 2. Sandbox Project Structure

**Requirement:** Each sandbox starts with:
- Empty/clean TS project scaffold
- Example `main.ts` that prints a known string
- Toolbelt directory with tool docs/examples

**Acceptance Criteria:**
- [ ] First-time run produces expected output from `main.ts`
- [ ] Toolbelt files readable from inside sandbox

### 3. External Access via Host Mediation Only

**Requirement:** Sandbox cannot access internet; external actions via Workbench only.

**Acceptance Criteria:**
- [ ] No internet access from sandbox (verified)
- [ ] No secrets accessible in sandbox
- [ ] All external interactions logged

### 4. Concurrency

**Requirement:** Support 5 concurrent sandboxes for MVP.

**Acceptance Criteria:**
- [ ] At 5 sessions, new requests receive 503 with clear message
- [ ] Sessions cleaned up properly to free slots

### 5. Deployment & Configuration

**Requirement:** Straightforward self-host path.

**Acceptance Criteria:**
- [ ] `docker compose up` starts everything
- [ ] Config via environment variables
- [ ] Clone → running → first execution in < 15 minutes

---

## Non-Functional Requirements

### Security (P0)
- No secrets inside sandbox
- No outbound internet from sandbox
- Clear trust boundary: sandbox untrusted, host enforces policies
- Auditable external actions

### Reliability
- Auto-cleanup works even after errors
- Failures provide actionable error messages

### Performance
- Sandbox cold start: reasonable on homelab hardware
- Command execution overhead: low enough for iterative workflows

### Usability
- Toolbelt easy to modify by editing files
- Compatible with LibreChat via `X-Conversation-Id`

---

## Success Metrics

| Category | Metric | Target |
|----------|--------|--------|
| Activation | Time to first successful run | ≤ 15 minutes |
| Security | Internet access from sandbox | 0 (verified) |
| Security | Secrets in sandbox | 0 (verified) |
| Reliability | Orphaned sandboxes | 0 |
| Concurrency | Parallel sessions | 5 |

---

## Definition of Done

- [ ] Server deployed via docker-compose with API token
- [ ] `X-Conversation-Id` required and maps 1:1 to sandbox
- [ ] Stateful iteration works within session
- [ ] Toolbelt present and readable; `main.ts` runs
- [ ] Sandboxes have no internet and no secrets
- [ ] External actions only via host-mediated tools
- [ ] Idle timeout (10 min) works; containers cleaned up
- [ ] Supports 5 parallel sessions reliably
- [ ] Docs: install, config, threat model, how to add tools
