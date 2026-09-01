# Porting Guide: Migrating from Codex to Claude Code

> **Technical Reference**: Architectural migration, system differences, and design decisions when transitioning `codex-with-chatgpt` to `claude-code-with-chatgpt` (`c2c`).  
> **Source Baseline**: `codex-with-chatgpt` v0.1.1  
> **Target System**: `claude-code-with-chatgpt` (Local Executor: Claude Code CLI, Reasoning Brain: ChatGPT Web)

---

## 1. Motivation & Paradigm Shift

The original `codex-with-chatgpt` project demonstrated the power of decoupling:
- **Thinking**: High-level reasoning, architecture decomposition, and code reviews handled by ChatGPT Web subscriptions (Plus / Pro).
- **Working**: Local file edits, git operations, and test executions handled by a local coding agent.

However, the original upstream implementation was tightly coupled to OpenAI's **Codex CLI runtime** and its embedded Electron/Chromium In-App Browser (`iab`). 

### Why Claude Code?
1. **Model & Gateway Agility**: Claude Code operates as a flexible local execution engine. Developers can run it using Anthropic's Claude 3.5 Sonnet / 3.7 Sonnet, or connect through transparent proxies and gateways (such as 9Router, Google Gemini, Amazon Bedrock, or local model endpoints).
2. **Standardized Extensibility**: Claude Code introduces native Project Skills (`.claude/skills/`), fine-grained subagents (`.claude/agents/`), lifecycle hooks, and structured JSON configuration (`.claude/settings.json`).
3. **Enterprise Security & Worktrees**: Native git worktree isolation (`isolation: worktree`) and declarative tool permission allowlists.

---

## 2. Structural & Architectural Comparison

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│           OpenAI Codex               │             Claude Code              │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ ~/.codex/skills/<name>/SKILL.md      │ .claude/skills/chatgpt-collab/SKILL.md│
│ ~/.codex/config.toml (TOML)          │ .claude/settings.json (JSON)         │
│ [sandbox_workspace_write]            │ sandbox.filesystem.allowWrite        │
│ control-in-app-browser (iab API)     │ Mode C (Guided Manual) + Mode A Script│
│ Browser tab handoff markers          │ Terminal formatting + Artifacts      │
│ Ad-hoc unmanaged agent prompts       │ Declarative subagents (.claude/agents)│
│ Codex-specific prompt headers        │ Generalized executor metadata        │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## 3. Key Design Decisions

### 3.1 Control Plane Realignment: Replacing In-App Browser (`iab`)
- **The Challenge**: Codex CLI included an embedded Playwright-driven Electron browser (`agent.browsers.get("iab")`), allowing the agent to programmatically open ChatGPT Web, click buttons, fill out OAuth connector forms, and scrape responses from the DOM. Claude Code CLI runs strictly inside terminal emulators and does not ship with an interactive DOM automation tool.
- **The Solution (Two-Tier Architecture)**:
  1. **Mode C (Guided Manual Handoff - Primary Default)**:
     - Claude Code generates clean, copyable `[C2C]` prompt blocks.
     - The user copies the prompt to ChatGPT Web in their own browser.
     - ChatGPT queries workspace code directly via MCP and responds with `[C2C] STATE: PLAN`.
     - The user pastes the plan back into Claude Code.
     - *Advantage*: 100% immune to Cloudflare Turnstile, CAPTCHAs, 2FA logins, and DOM selector drift.
  2. **Mode A (Optional Scripted Automation)**:
     - For users seeking automation, a standalone Playwright script (`scripts/browser-agent.mjs`) is provided.
     - Claude Code can invoke this script via CLI to exchange messages, while gracefully falling back to Mode C if browser obstacles occur.

### 3.2 Configuration & Permission Management
- **Codex Mechanism**: The bridge manipulated `~/.codex/config.toml` directly using TOML string manipulation to insert `[sandbox_workspace_write].writable_roots`.
- **Claude Code Mechanism**: We introduced `src/config/claude-settings.ts` / `c2c config-allow`, which operates on Claude Code's standard `.claude/settings.local.json` (workspace) and `~/.claude/settings.json` (global). It merges:
  - `permissions.allow`: Pre-approves scoped `c2c` subcommands (`setup*`, `doctor*`, `status*`, `pair*`, `session*`, `record*`, etc.), excluding legacy commands.
  - `sandbox.filesystem.allowWrite`: Allowlisting `%LOCALAPPDATA%\claude-code-with-chatgpt` (Windows) and `~/Library/Application Support/claude-code-with-chatgpt` (macOS).
  - Preserves all unrelated user configuration, operates atomically, and fails closed without overwriting malformed JSON files.

### 3.3 Protocol Generalization
- All protocol wire states (`INIT`, `PLAN`, `EXECUTING`, `EXECUTED`, `REVIEW`, `DONE`, `BLOCKED`, `ERROR`, `HANDOFF`) were generalized to include the `EXECUTOR: "claude-code"` header.
- Prompts and templates were audited to remove vendor-specific jargon while preserving the invariant that **control messages stay under 1 KB** and never carry file content.

### 3.4 Security Hardening (Red-Team Audited)
During the porting process, several critical security enhancements were introduced:
1. **Windows NTFS Alternate Data Streams (`::$DATA`)**: Blocked colons in relative paths to prevent bypassing file filter rules via NTFS stream semantics.
2. **Trailing Dot Normalization**: Prevented Windows path normalization tricks (e.g. `.env.` resolving to `.env`).
3. **Case-Insensitive Sensitive Matching**: Normalized file paths before matching against `SENSITIVE_PATTERNS` to protect Windows and macOS case-insensitive filesystems.
4. **Git Metadata Protection**: Added `.git/` and `.git/**` to `SENSITIVE_PATTERNS` so that direct MCP `read_file` requests cannot leak `.git/config` credentials, while allowing sanitized `git_status` and `git_diff` operations.
5. **Modern API Key Redaction**: Updated the log sanitizer regex in `src/execution/sanitize.ts` to redact modern OpenAI project keys (`sk-proj-...`), Anthropic keys (`sk-ant-...`), and Google API keys (`AIza...`).

---

## 4. MCP Data Plane Invariant

The 9 read-only MCP tools remain completely compliant with the Model Context Protocol specification:
- `workspace_info`: Returns workspace identity and environment metadata.
- `list_directory`: Provides paginated directory listings with sensitive/noise file filtering.
- `read_file`: Line-paginated read with strict access controls.
- `search_workspace`: Fast ripgrep search with line offsets.
- `git_status`: Structured git working tree status.
- `git_diff`: Byte-paginated git diff against HEAD or staged commits.
- `test_status`: Inspection of latest test run summaries.
- `execution_summary`: Summary of recent execution iterations.
- `execution_output`: Sanitized stdout/stderr from recorded test/build commands.

The MCP server maintains **strict read-only enforcement**—no mutating tools (file creation, writing, deletion, shell commands, or git commits) exist within the bridge server.

---

## 5. Verification & Testing

The port was validated against a comprehensive multi-tier test suite:
- **Unit & Security Tests**: Path traversal containment, symlink escape rejection, NTFS stream denial, and secret redaction.
- **Protocol Tests**: OAuth 2.1 authorization code flow, PKCE S256 validation, and DCR registration.
- **MCP Integration Tests**: End-to-end tool execution over Streamable HTTP.
- **Claude Skill Tests**: Skill YAML frontmatter syntax and progressive reference resolution.

To run the verification suite:
```bash
pnpm test
pnpm typecheck
```
