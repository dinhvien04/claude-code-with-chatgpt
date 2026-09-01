# Consensus Porting Plan: `claude-code-with-chatgpt` (`c2c`)

> **Document Status**: Final Architectural Plan for Implementation Wave  
> **Source Baseline**: `codex-with-chatgpt` v0.1.1  
> **Target System**: `claude-code-with-chatgpt` (Local Executor: Claude Code CLI, Reasoning Layer: ChatGPT Web / Plus / Pro)  
> **Core Philosophy**: *"ChatGPT thinks. Claude Code works."*

---

## 1. Executive Summary & Cross-Agent Debate Resolution

In Phase A, six independent research agents audited the upstream repository, the Claude Code platform runtime, C2C wire protocol, security perimeter, testing coverage, and control-plane capabilities.

### Cross-Agent Challenge & Consensus Matrix

| Challenging Agent | Target Proposal | Identified Flaw / Risk | Resolution & Consensus |
| :--- | :--- | :--- | :--- |
| **`security-red-team`** | `claude-platform-architect` | Automated Claude Code hooks in `settings.json` might leak env vars or run with unchecked execution rights in untrusted repos. | Hooks will only run static, parameter-safe CLI commands (`c2c doctor`, `c2c record`) and will never evaluate arbitrary repo-supplied shell scripts. |
| **`protocol-specialist`** | `security-red-team` | Blocking `.git/` in `SENSITIVE_PATTERNS` could break `git_status` / `git_diff` MCP tools if implemented at filesystem manager layer. | Direct file reads (`read_file`, `list_directory`, `search_workspace`) strictly block `.git/**`. Git tools (`git_status`, `git_diff`) use subprocess `git` commands with sanitization. |
| **`claude-platform-architect`** | `control-plane-investigator` | Optional headless Playwright automation script might fail unpredictably under Cloudflare Turnstile or CAPTCHAs. | **Mode C (Guided Manual Handoff)** is established as the primary, 100% reliable default. Mode A (Headless script) is an optional utility that immediately yields to Mode C on any friction. |
| **`control-plane-investigator`** | `protocol-specialist` | Protocol state strings might carry Codex branding into ChatGPT prompts, degrading model compliance. | Generalize all protocol metadata and prompt templates to generic `executor: "claude-code"` while preserving exact wire states (`INIT`, `PLAN`, `EXECUTED`, `REVIEW`, `DONE`, `BLOCKED`, `ERROR`, `HANDOFF`). |

---

## 2. Target Architecture

```
                 ┌───────────────────────────────────────────────┐
                 │          ChatGPT Web / Projects               │
                 │       (Reasoning / Planning / Review)         │
                 └───────────────┬───────────────────────▲───────┘
                                 │                       │
                   MCP Data Plane│                       │Control Plane (<1 KB)
            (Streamable HTTP + OAuth 2.1)                │Mode C: Guided Manual Handoff
                                 ▼                       │Mode A: Optional Script
                 ┌───────────────────────────────────────┴───────┐
                 │            C2C Bridge Daemon                  │
                 │  - Loopback HTTP (127.0.0.1:48765)            │
                 │  - OAuth 2.1 AS + PKCE (RFC 8414 / RFC 7591)  │
                 │  - CSPRNG One-Time Pairing Manager            │
                 │  - 9 Read-Only MCP Tools                      │
                 │  - Cloudflare Tunnel (Quick / Named)          │
                 │  - Windows & POSIX Path Hardening             │
                 └───────────────────────┬───────────────────────┘
                                         │
                   Canonical Realpaths   │ Read-Only Containment
                   Case-Insensitive Match│
                   NTFS Stream Rejection │
                                         ▼
                 ┌───────────────────────────────────────────────┐
                 │               Local Workspace                 │
                 │   (Source files, git repo, .c2cignore)        │
                 └───────────────────────▲───────────────────────┘
                                         │
                     File Edits / Shell  │ Git Commits / Tests
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │            Claude Code CLI Harness            │
                 │  - .claude/skills/chatgpt-collab/SKILL.md     │
                 │  - Provider-Agnostic Backend (9Router/etc.)   │
                 │  - Native Permissions & Worktree Support      │
                 └───────────────────────────────────────────────┘
```

---

## 3. Module Categorization & Lifecycle Breakdown

### A. Preserved Unchanged (High-Assurance Core)
- `src/auth/oauth.ts` & `src/auth/store.ts` (OAuth 2.1, Dynamic Client Registration RFC 7591, PKCE S256, token hashing).
- `src/auth/html.ts` & `src/auth/middleware.ts` (Secure pairing page, CSP `default-src 'none'`, bearer validation).
- `src/pairing/manager.ts` (8-char CSPRNG codes, 5-min TTL, 5-attempt lockout, rate-limiting).
- `src/tunnel/provider.ts`, `src/tunnel/cloudflared.ts`, `src/tunnel/cloudflared-named.ts`, `src/tunnel/named-provision.ts`, `src/tunnel/detect.ts`, `src/tunnel/hostname.ts`, `src/tunnel/state.ts` (Cloudflare tunnel supervisors).
- `src/session/state.ts` (Dual-state checkpoint manager).
- `src/process/daemon.ts` (Daemon lifecycle and health monitoring).
- `src/logger/index.ts` (Scrubbing logger).

### B. Generalized / Hardened Modules
1. **`src/workspace/manager.ts`**:
   - Add NTFS Alternate Data Stream (`::$DATA`) and colon rejection on Windows.
   - Add trailing dot (`.`) and trailing whitespace normalization/rejection.
   - Enforce case-insensitive matching for sensitive files on Windows and macOS.
   - Retain deepest-ancestor canonical realpath resolution.
2. **`src/workspace/ignore.ts`**:
   - Move `.git/` and `.git/**` into `SENSITIVE_PATTERNS` so `read_file` rejects `.git/config` and git internal metadata.
   - Expand `SENSITIVE_PATTERNS` to cover `.envrc`, `*.env`, `kubeconfig`, `.kube/`, `.docker/config.json`, `client_secret*.json`, `*.ppk`, `.vault-token`.
   - Implement platform-aware case-normalization.
3. **`src/execution/sanitize.ts`**:
   - Update API key redactor regex to match modern OpenAI project keys (`sk-proj-...`), Anthropic keys (`sk-ant-...`), and Google API keys.
4. **`src/bridge/server.ts`**:
   - Change `app.set("trust proxy", true)` to `app.set("trust proxy", "loopback")` to prevent `X-Forwarded-For` spoofing on secondary rate limiters.
5. **`src/mcp/server.ts`**:
   - Generalize tool descriptions from "Codex harness" to "local executor harness (Claude Code)".
   - Retain all 9 read-only tool contracts and parameter schemas.
6. **`src/execution/records.ts`**:
   - Add optional `executor` identifier (`"claude-code" | "codex" | "cli"`) to execution metadata.
7. **`src/config/sandbox-allow.ts`**:
   - Generalize to `src/config/harness-allow.ts` (or preserve Codex helper while adding Claude Code permissions helper).

### C. Replaced / Deprecated Components
- `skill/SKILL.md` (Codex-specific `$CODEX_HOME` skill) -> Ported to `.claude/skills/chatgpt-collab/SKILL.md`.
- `agent.browsers.get("iab")` (In-App Browser DOM automation) -> Replaced with Mode C (Guided Manual Handoff) and optional CLI script `scripts/browser-agent.mjs`.

### D. New Claude Code Components
1. **`.claude/skills/chatgpt-collab/SKILL.md`**: Native Claude Code project skill with standard progressive disclosure frontmatter, `/chatgpt-collab` command, guided prompt templates, and execution checkpoint workflows.
2. **`.claude/settings.json`**: Project settings with tool permissions, path configurations, and optional non-blocking lifecycle hooks.
3. **`scripts/browser-agent.mjs`** (Optional helper): Standalone Node.js script using Playwright to automate pairing and prompt handoff when external browser automation is explicitly enabled.

---

## 4. Protocol Compatibility & Security Invariants

### Protocol Invariants
- Dual-plane separation: Control messages strictly $< 1\text{ KB}$; Data plane handles code/diff extraction.
- Wire states preserved: `INIT`, `PLAN`, `EXECUTING`, `EXECUTED`, `REVIEW`, `DONE`, `BLOCKED`, `ERROR`, `HANDOFF`.
- Dynamic Client Registration & Protected Resource Metadata strictly compliant with RFC 8414 / RFC 7591.

### Strict Security Invariants
- **ChatGPT MUST REMAIN READ-ONLY**: No shell execution, file write, file delete, process spawn, or git mutation exposed over MCP.
- **Credential Protection**: Hard rejection of private keys; automatic redaction of tokens and home directories in execution output.
- **Containment Boundary**: Symlinks or traversal escaping the workspace root are blocked with `PATH_OUTSIDE_WORKSPACE`.
- **Zero Provider Hardcoding**: Claude Code operates transparently with any model backend (Anthropic, Gemini, 9Router, OpenAI).

---

## 5. Control Plane Specification

- **Mode C (Guided Manual Handoff - Default)**:
  - Claude Code generates clean, single-click copyable `[C2C]` prompt blocks.
  - User pastes into ChatGPT Web.
  - ChatGPT autonomously queries the codebase via MCP and replies with `[C2C] STATE: PLAN`.
  - User pastes plan into Claude Code; Claude Code implements, tests, and records execution (`c2c record`).
  - Claude Code generates `[C2C] STATE: EXECUTED`; user sends to ChatGPT for final review and verification.
- **Mode A (Optional Automation Script)**:
  - Invoked only if user explicitly executes `node scripts/browser-agent.mjs`.
  - Fails cleanly to Mode C if CAPTCHA / 2FA is encountered.

---

## 6. Implementation File Ownership Matrix

To prevent concurrent write conflicts, files are assigned with strict single-agent ownership:

| Agent Name | Role | Assigned Files & Modules |
| :--- | :--- | :--- |
| **`bridge-implementer`** | Core Bridge & Security Hardening | `src/workspace/manager.ts`<br>`src/workspace/ignore.ts`<br>`src/execution/sanitize.ts`<br>`src/execution/records.ts`<br>`src/bridge/server.ts`<br>`src/mcp/server.ts`<br>`src/config/sandbox-allow.ts`<br>`src/version.ts` |
| **`claude-integration-implementer`** | Claude Code Skill & Harness Integration | `.claude/skills/chatgpt-collab/SKILL.md`<br>`.claude/settings.json`<br>`scripts/browser-agent.mjs`<br>`skill/SKILL.md` (bridge reference update) |
| **`test-implementer`** | Test Suite Expansion & Hardening | `tests/workspace.test.ts`<br>`tests/git.test.ts`<br>`tests/execution-output.test.ts`<br>`tests/mcp-integration.test.ts`<br>`tests/oauth.test.ts`<br>`tests/pairing.test.ts`<br>`tests/claude-skill.test.ts` (new)<br>`tests/security-redteam.test.ts` (new) |
| **`docs-implementer`** | Documentation & Architecture Specs | `README.md`<br>`README.zh-CN.md`<br>`docs/architecture.md`<br>`docs/protocol.md`<br>`docs/security.md`<br>`docs/troubleshooting.md`<br>`docs/claude-code-port.md` (new) |

---

## 7. Quality Gates & Verification Checklist

Before Phase D completion, the system must pass:
1. `pnpm typecheck` (TypeScript strict mode, zero errors).
2. `pnpm test` (All existing and new security/protocol test suites pass 100%).
3. `pnpm build` (Clean build output in `dist/`).
4. End-to-end local MCP and pairing smoke verification.
