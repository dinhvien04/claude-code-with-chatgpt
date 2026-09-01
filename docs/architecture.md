# Architecture

```
                 ┌───────────────────────────────────────────────┐
                 │          ChatGPT Web / Projects               │
                 │       (Reasoning / Planning / Review)         │
                 └───────────────┬───────────────────────▲───────┘
                                 │                       │
                   MCP Data Plane│                       │ Control Plane (<1 KB)
            (Streamable HTTP + OAuth 2.1)                │ Mode C: Guided Manual Handoff
                                 ▼                       │ Mode A: Optional Script
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
                 │  - Native Slash Command: /chatgpt-collab      │
                 │  - Provider-Agnostic Execution Engine         │
                 │  - Worktree Isolation & Settings Allowlist    │
                 └───────────────────────────────────────────────┘
```

---

## Core Principles

- **ChatGPT thinks. Claude Code works.** The bridge routes architectural planning, task decomposition, and code reviews to ChatGPT Web, while Claude Code CLI executes file modifications, runs tests, and manages git commits locally.
- **Dual-Plane Separation**:
  - **Control Plane**: Lightweight structured `[C2C]` state messages (< 1 KB) exchanged between human, Claude Code, and ChatGPT.
  - **Data Plane**: Direct, read-only MCP over Streamable HTTP. ChatGPT pulls files, diffs, git trees, and test records independently.
- **Read-Only by Construction**: No mutating tools (write, delete, shell, git commit) exist on the MCP server. Prompt injection cannot compromise the local filesystem.
- **Strict Workspace Containment**: One bridge daemon = one workspace = one token audience. Symlink resolution, canonical realpaths, and case-insensitive pattern matching prevent unauthorized escapes.
- **Provider-Agnostic Local Execution**: Claude Code serves as the execution engine and operates transparently regardless of the underlying backend (Anthropic API, 9Router, Google Gemini, Amazon Bedrock, or custom local gateways).

---

## Control Plane Realization (Modes C, P & A)

Claude Code runs primarily as a native CLI terminal tool without an embedded GUI/Electron browser environment. The control plane accommodates this through three operational modes:

1. **Mode C: Guided Manual Handoff (Default for Pro / Team / Enterprise / Edu / Business)**
   - Claude Code formats single-click copyable `[C2C]` prompt blocks (< 1 KB) in the terminal.
   - The user pastes the block into ChatGPT Web.
   - ChatGPT queries the workspace via read-only MCP tools and replies with `[C2C] STATE: PLAN`.
   - The user pastes the plan back to Claude Code. Claude Code implements, verifies, and records execution (`c2c record`).
   - Claude Code generates `[C2C] STATE: EXECUTED` for the user to pass to ChatGPT for final review.
   - 100% reliable, zero browser automation dependencies, resilient to CAPTCHAs and 2FA.

2. **Mode P: Plus Manual Context Handoff (100% Local for Plus / Free)**
   - Operates entirely locally with zero `cloudflared`, zero tunnels, zero daemons, and zero OAuth setup.
   - Deterministic CLI generator (`c2c bundle plan` and `c2c bundle review`) packages project trees, selected source snippets, git diffs, and sanitized test outputs into bounded context envelopes (`INIT_P`, `EXECUTED_P`).
   - Hard limits enforced: total bundle <= 48 KB, directory tree <= 100 entries (depth <= 3), source snippets <= 200 lines / 16 KB, git diff <= 200 lines / 24 KB.
   - Strict defense-in-depth sanitization reuses `Workspace.resolve` and `sanitizeExecutionOutput` to block sensitive files and redact API keys/credentials.

3. **Mode A: Optional Scripted Automation (`scripts/browser-agent.mjs`)**
   - For users who prefer semi-automated browser interactions, an optional standalone Playwright script can transfer prompts.
   - Designed to gracefully fail over to Mode C immediately upon encountering Cloudflare Turnstile, login prompts, or DOM timeouts.

---

## Component Architecture (`src/`)

| Module | Responsibility |
| :--- | :--- |
| `bridge/` | Express application setup, loopback listener (127.0.0.1), port fallback/reuse, daemon runtime state, and local loopback admin API. |
| `mcp/` | Model Context Protocol server exposing 9 read-only tools via stateless Streamable HTTP transport. |
| `bundle/` | Deterministic local Mode P context package generator: hierarchical budget enforcement (48 KB max), directory tree builder, bounded file snippets, and sanitized diff packaging. |
| `auth/` | OAuth 2.1 authorization server compliant with RFC 8414 (discovery metadata), RFC 7591 (dynamic client registration), RFC 7636 (PKCE S256), RFC 6819 Section 5.2.2.3 token family tracking, generation counters, tombstones, replay attack revocation cascades, and RFC 7009 revocation. Tokens stored as SHA-256 hashes. |
| `pairing/` | One-time pairing code manager: CSPRNG generation, 5-minute TTL, 5-attempt brute-force protection, IP rate limiting, and single-use invalidation. |
| `workspace/` | Workspace security boundary: canonical realpath resolution of deepest ancestors, Windows NTFS alternate stream rejection (`::$DATA`), case-insensitive sensitive file filtering, `.c2cignore` evaluation, paginated reads, ripgrep searches, and sanitized git status/diff inspection. |
| `tunnel/` | `TunnelProvider` abstraction managing Cloudflare Quick Tunnels and named custom domains with health supervision and automatic reconnection. |
| `execution/` | Execution record lifecycle (`c2c record`), tracking modified files, exit statuses, and sanitized test/build logs (`execution_output`) for ChatGPT review. |
| `process/` | Background daemon supervision, cross-platform PID management, and graceful shutdown handlers. |
| `cli/` | The `c2c` CLI interface (`setup`, `doctor`, `pair`, `unpair`, `status`, `logs`, `stop`, `bundle`, `config-allow`). |
| `config/`, `logger/` | Cross-platform state directories (`%LOCALAPPDATA%` on Windows, `~/Library/Application Support` on macOS, `~/.local/state` on Linux) and secret-redacting logging. |

---

## Request & Data Lifecycles

### 1. Read-Only MCP Request Flow
```
ChatGPT Web
    │
    ▼ (HTTPS via Cloudflare Tunnel)
C2C Bridge (/mcp endpoint)
    │
    ▼ Bearer Token Validation (OAuth 2.1 SHA-256 lookup)
Stateless Streamable HTTP Handler
    │
    ▼ Tool Dispatcher (e.g. read_file, git_diff, search_workspace)
Workspace Security Layer
    │ ├── Canonical realpath verification (inside workspace root)
    │ ├── Case-insensitive sensitive file filter (.env*, keys, .git/**)
    │ └── Output pagination & size caps
    ▼
JSON Response -> Cloudflare Tunnel -> ChatGPT Web
```

### 2. OAuth 2.1 Authorization & Pairing Flow
1. **Challenge**: ChatGPT initiates connection to `/mcp` without credentials; Bridge returns `401 Unauthorized` with `WWW-Authenticate: resource_metadata="..."`.
2. **Metadata Discovery**: ChatGPT fetches `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`.
3. **Dynamic Client Registration**: ChatGPT registers client credentials via RFC 7591 at `/oauth/register`.
4. **Pairing Verification**: ChatGPT opens browser to `/oauth/authorize`. User enters the 8-character CSPRNG pairing code.
5. **Code Issuance**: Upon successful verification, the bridge issues a one-time authorization code and redirects back to ChatGPT with state.
6. **Token Exchange**: ChatGPT trades authorization code + PKCE code verifier at `/oauth/token` for scoped access and refresh tokens.

### 3. Port Allocation & Recovery
- The bridge daemon defaults to port `48765` bound strictly to `127.0.0.1`.
- If occupied, the bridge queries `/health`. If occupied by an existing C2C daemon for the same workspace, it is reused. If occupied by an alien process, an ephemeral port is selected automatically.
- The active port and admin token are persisted to the local runtime state file; users and clients interact through CLI commands without manual port management.

### 4. Tunnel Resilience
- **Quick Tunnel (Default)**: Automatically provisions a transient `*.trycloudflare.com` URL. If restarted, `c2c doctor` detects the address rotation and prompts the user to update the connector.
- **Named Tunnel (Optional Custom Domain)**: Configured via `c2c tunnel choose --mode named --zone <domain>`. Cloudflare DNS routes a stable hostname (e.g., `c2c-<project>.example.com`) directly to the local daemon, surviving reboots and restarts without requiring connector recreation.
