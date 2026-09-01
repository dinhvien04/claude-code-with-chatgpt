# Claude Code Architecture for ChatGPT Planning Bridge

> **Mission**: Design the definitive Claude Code equivalent architecture for `codex-with-chatgpt` (now `claude-code-with-chatgpt` / `c2c`).  
> **Core Principle**: **ChatGPT thinks. Claude Code works.** ChatGPT acts as the high-level reasoning, planning, and review brain via an OAuth 2.1-authenticated read-only MCP data plane, while Claude Code retains full local execution ownership (editing, shell commands, test execution, git management, and state tracking).

---

## 1. Executive Summary & Architectural Overview

The original system was designed around the **OpenAI Codex** ecosystem, leveraging Codex-specific configuration files (`~/.codex/config.toml`), Codex sandbox writable roots, and an embedded Electron/Chromium browser tool (`control-in-app-browser` / `iab`).

Porting this architecture to **Anthropic Claude Code** requires adapting to Claude Code's native extensibility framework:
1. **Skill System**: Migrating from `~/.codex/skills/` to `.claude/skills/claude-with-chatgpt/SKILL.md` using Claude Code's progressive disclosure standard (YAML frontmatter + Markdown body + bundled `references/` and `scripts/`).
2. **Permissions & Sandbox Model**: Replacing Codex's `[sandbox_workspace_write].writable_roots` TOML manipulation with Claude Code's JSON-based `permissions.allow`, `permissions.additionalDirectories`, and `sandbox.filesystem.allowWrite` in `.claude/settings.json`.
3. **Automated Lifecycle Hooks**: Leveraging Claude Code's native `PreToolUse`, `PostToolUse`, `SessionStart`, and `Stop` hooks in `settings.json` to automate execution recording, health probes, and session consistency without manual user intervention.
4. **Control Plane Realignment**: Explicitly addressing the difference between Codex's native In-App Browser (`iab`) and Claude Code's terminal CLI environment. Because Claude Code does not ship with an interactive DOM automation browser tool, the architecture establishes a robust **Guided Manual Handoff** as the primary reliable baseline, augmented by an **Optional Headless Playwright CLI Script** and a visual **Artifact Dashboard**.
5. **Data Plane Preservation**: Retaining the 100% compliant Model Context Protocol (MCP) Streamable HTTP server, OAuth 2.1 PKCE authorization server, Cloudflare Quick/Named Tunnel provider, and local execution sanitizer.

---

## 2. Architectural Classification Matrix

Every architectural component is explicitly classified below according to its factual availability in the Claude Code runtime environment.

| Component | Sub-System / Capability | Classification | Claude Code Equivalent / Implementation |
|---|---|---|---|
| **Skill Definition** | Skill frontmatter & body | **SUPPORTED** | `.claude/skills/claude-with-chatgpt/SKILL.md` with standard YAML (`name`, `description`). |
| **Skill Loading** | Progressive disclosure & references | **SUPPORTED** | Metadata in context -> Body on invocation -> `references/` & `scripts/` loaded on demand. |
| **Skill Invocation** | Model triggering & slash command | **SUPPORTED** | Triggered via `Skill` tool (`skill: "claude-with-chatgpt"`) or user typing `/claude-with-chatgpt`. |
| **Harness Execution** | Shell, file editing, workspace search | **SUPPORTED** | Native Claude Code tools: `Bash`, `PowerShell`, `Edit`, `Write`, `Read`, `Glob`, `Grep`. |
| **MCP Server (C2C Data Plane)** | 9 Read-Only MCP Tools over HTTP | **SUPPORTED** | Standalone Node.js Express server running Streamable HTTP with OAuth 2.1 + PKCE. |
| **MCP Client (Claude Code side)** | Connecting Claude to external MCPs | **SUPPORTED** | `.mcp.json` or `settings.json` (`mcpServers`) supporting stdio, SSE, and HTTP transports. |
| **Configuration Management** | Project & User settings | **SUPPORTED** | `.claude/settings.json`, `.claude/settings.local.json`, and `~/.claude/settings.json`. |
| **Sandbox & Permissions** | State directory & tool allowlists | **SUPPORTED** | `permissions.allow`, `permissions.additionalDirectories`, `sandbox.filesystem.allowWrite`, `sandbox.network.allowedDomains`. |
| **Lifecycle Automation** | Pre/Post tool interception | **SUPPORTED** | Claude Code Hooks in `settings.json` (`PostToolUse`, `SessionStart`, `Stop`). |
| **Worktree Isolation** | Background / branch isolation | **SUPPORTED** | `EnterWorktree`, `ExitWorktree`, `worktree.baseRef`, `worktree.bgIsolation` in `settings.json`. |
| **Subagents** | Multi-agent coordination | **SUPPORTED** | `.claude/agents/*.md`, `Agent` tool (`fork`, `general-purpose`), `SendMessage`. |
| **Visual Dashboard** | UI state & progress rendering | **SUPPORTED** | Claude Code `Artifact` tool (renders interactive HTML/CSS/JS status cards). |
| **In-App Browser (IAB)** | Embedded Playwright DOM scripting (`agent.browsers.get("iab")`) | **UNSUPPORTED** | **No native browser automation tool exists in Claude Code CLI.** |
| **Browser Handoff / Setup** | Configuring ChatGPT Connectors & Auth | **MANUAL FALLBACK** | Step-by-step guided instructions with direct URLs; user performs click/paste once. |
| **Automated Browser Scripting** | Headless connector setup & control | **PARTIALLY SUPPORTED** | Custom standalone Playwright script (`scripts/browser-sync.mjs`) executed via `Bash`/`PowerShell`. |

---

## 3. Structural Comparison: Codex vs. Claude Code

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ARCHITECTURAL MAPPING                           │
├───────────────────────────────────┬─────────────────────────────────────────┤
│           OpenAI Codex            │               Claude Code               │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ ~/.codex/skills/<name>/SKILL.md   │ .claude/skills/<name>/SKILL.md          │
│ ~/.codex/config.toml              │ .claude/settings.json                   │
│ [sandbox_workspace_write]         │ sandbox.filesystem.allowWrite           │
│ control-in-app-browser (iab)      │ Guided Manual + Optional CLI Script     │
│ markHandoff() / markDeliverable() │ Artifact Dashboard + Terminal Summary   │
│ Ad-hoc subagents                  │ .claude/agents/*.md + Agent Tool        │
│ Manual execution recording loop   │ PostToolUse Hook + c2c record CLI       │
│ $CODEX_HOME                       │ CLAUDE_CONFIG_DIR (~/.claude)           │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

---

## 4. Detailed Component Design

### 4.1 Skill Architecture (`.claude/skills/claude-with-chatgpt/`)

Claude Code skills follow a standardized file structure and progressive loading protocol:

```
.claude/skills/claude-with-chatgpt/
├── SKILL.md                 # Primary skill instructions (< 500 lines)
├── references/
│   ├── protocol.md          # [C2C] state machine & control message formats
│   ├── recovery.md          # Doctor gate, address reclaim & troubleshooting
│   └── guided-setup.md      # Exact manual steps for ChatGPT Web connector
└── scripts/
    └── browser-agent.mjs    # Optional Playwright automation helper
```

#### SKILL.md Frontmatter Specification
```yaml
---
name: claude-with-chatgpt
description: >
  Use ChatGPT Web as the planning and review brain for Claude Code coding sessions,
  while Claude Code retains full local execution ownership (editing, testing, git).
  Use whenever the user says "使用 Claude with ChatGPT", "Connect ChatGPT", "用 ChatGPT 规划",
  "Set up Claude with ChatGPT", or asks to run a task through the ChatGPT planning loop.
---
```

#### Progressive Disclosure Rules:
1. **Level 1 (Metadata)**: `name` and `description` are continuously available in Claude Code's system context.
2. **Level 2 (Skill Body)**: Loaded only when the skill triggers. Contains high-level golden rules, CLI invocation patterns, and state transitions.
3. **Level 3 (Bundled References)**: Loaded via the `Read` tool on demand (e.g., loading `references/protocol.md` only during message construction).

---

### 4.2 Configuration, Permissions & Sandbox Model

Codex stored configuration in TOML format at `~/.codex/config.toml`. Claude Code uses a three-tier JSON configuration hierarchy:
- **Global User**: `~/.claude/settings.json`
- **Project Shared**: `.claude/settings.json`
- **Project Local (Gitignored)**: `.claude/settings.local.json`

#### `.claude/settings.json` Configuration
```json
{
  "permissions": {
    "allow": [
      "Bash(node */bin/c2c.js *)",
      "Bash(c2c *)",
      "Bash(git status*)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(pnpm test*)",
      "Bash(npm test*)",
      "Read",
      "Edit",
      "Write"
    ],
    "additionalDirectories": [
      "%LOCALAPPDATA%\\claude-with-chatgpt",
      "~/.local/state/claude-with-chatgpt",
      "~/Library/Application Support/claude-with-chatgpt"
    ]
  },
  "sandbox": {
    "enabled": true,
    "filesystem": {
      "allowWrite": [
        "%LOCALAPPDATA%\\claude-with-chatgpt",
        "~/.local/state/claude-with-chatgpt",
        "~/Library/Application Support/claude-with-chatgpt"
      ]
    },
    "network": {
      "allowedDomains": [
        "*.cloudflare.com",
        "*.trycloudflare.com",
        "chatgpt.com",
        "127.0.0.1",
        "localhost"
      ]
    }
  }
}
```

#### Path Resolution Mapping:
- **State Directory (`getStateDir()`)**:
  - macOS: `~/Library/Application Support/claude-with-chatgpt`
  - Windows: `%LOCALAPPDATA%\claude-with-chatgpt`
  - Linux: `$XDG_STATE_HOME/claude-with-chatgpt` (or `~/.local/state/claude-with-chatgpt`)
- **CLI Command Replacement**:
  - Old: `c2c sandbox-allow --json` (wrote to `.codex/config.toml`)
  - New: `c2c config-allow --json` (idempotently updates `.claude/settings.json` / `~/.claude/settings.json` with permissions and sandbox entries).

---

### 4.3 Lifecycle Hooks Architecture

Claude Code allows registering event-driven hooks in `.claude/settings.json`. This replaces manual repetitive steps in the skill with deterministic execution.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR}/bin/c2c.js\" doctor --json --no-fix",
            "timeout": 15,
            "statusMessage": "Verifying C2C Bridge health..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' | grep -E '(test|vitest|jest|pytest|cargo test)' >/dev/null && node \"${CLAUDE_PROJECT_DIR}/bin/c2c.js\" record --task auto --iteration 0 --tests \"auto-recorded\" || true",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ]
  }
}
```

#### Hook Capabilities:
1. **`SessionStart`**: Proactively verifies that the local bridge and Cloudflare tunnel are active before the user starts chatting.
2. **`PostToolUse`**: Automatically captures test outputs from `Bash`/`PowerShell` commands and feeds them into `c2c record` for ChatGPT's review via MCP.
3. **`Stop`**: Ensures session checkpoints are clean when the task finishes.

---

### 4.4 Data Plane: Read-Only MCP Server

The data plane remains identical in protocol design and security guarantees:

```
ChatGPT Web (Browser)
      │
      │ HTTPS (Streamable HTTP + OAuth 2.1 Bearer Token)
      ▼
Cloudflare Quick / Named Tunnel
      │
      │ Loopback (127.0.0.1:48765)
      ▼
C2C Bridge (Express + McpServer)
      │
      ├── workspace_info      (Identity, project type, git status)
      ├── list_directory      (Paginated file tree, ignores node_modules/.git)
      ├── read_file           (Line-range paginated; denies .env, keys, credentials)
      ├── search_workspace    (Ripgrep content search with line numbers)
      ├── git_status          (Structured staged/unstaged/untracked files)
      ├── git_diff            (Byte-offset paginated diff against HEAD/staged)
      ├── test_status         (Summary of latest test run from execution record)
      ├── execution_summary   (Recent iteration records: changed files, status)
      └── execution_output    (Sanitized stdout/stderr from recorded test runs)
```

#### Security Boundaries:
- **Loopback Binding**: Express binds strictly to `127.0.0.1`.
- **OAuth 2.1 + PKCE (RFC 7636, S256)**: Public requests without valid bearer tokens receive `401 Unauthorized` with Protected Resource Metadata.
- **Canonical Realpath Containment**: Symlink traversal and `../` escapes are prevented.
- **Sanitized Execution Logs**: High-entropy strings, authorization headers, private keys, and file paths matching sensitive patterns are redacted before storage.

---

### 4.5 Control Plane Architecture: Replacing Codex In-App Browser

#### The In-App Browser Reality
- **Codex**: Implemented `control-in-app-browser` which provided an internal Chromium browser instance accessible via JavaScript APIs (`agent.browsers.get("iab")`). Codex could programmatically click elements, type pairing codes into forms, and poll DOM nodes for ChatGPT responses.
- **Claude Code CLI**: Operates as a pure CLI application in standard terminal emulators. **No built-in interactive browser tool exists.**

#### The Three-Pillar Control Plane Solution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          THREE-PILLAR CONTROL PLANE                         │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ 1. Guided Manual Handoff      │ Baseline default. Zero external deps.       │
│    (Primary - Robust)         │ Claude presents exact URLs & [C2C] blocks.  │
│                               │ User clicks and pastes in browser.          │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 2. Visual Artifact Dashboard  │ Claude calls Artifact tool to generate a    │
│    (User Experience)          │ live local HTML dashboard with 1-click copy │
│                               │ buttons and state progress indicators.      │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 3. Headless Playwright Script │ Optional automation via CLI tool execution. │
│    (Optional Automation)      │ node scripts/browser-agent.mjs handles DOM  │
│                               │ login and message exchange automatically.   │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

#### 1. Guided Manual Handoff (Baseline Protocol)
When setting up or communicating with ChatGPT:
1. Claude runs `c2c setup --json` to start the bridge and get the `mcpUrl` and `pairingCode`.
2. Claude outputs a streamlined, human-readable prompt with exact URLs:
   - Developer Mode: `https://chatgpt.com/#settings/Security`
   - Connectors Hub: `https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins`
3. Claude presents the exact values: Name, Description, Server URL (`mcpUrl`), and Pairing Code.
4. User completes the step and replies `Ready` / `好了`.
5. Claude verifies connection via `c2c doctor --json`.

#### 2. Visual Artifact Dashboard (`Artifact` Tool)
Claude Code supports generating dynamic HTML/CSS/JS artifacts using the `Artifact` tool:
- Renders an interactive Web Card showing Bridge status, Tunnel URL, pairing code with active countdown, and current iteration state.
- Provides "Copy INIT Payload" and "Copy EXECUTED Payload" buttons for seamless user transfer.

#### 3. Optional Headless Browser Automation Helper
For users who prefer automation:
- A standalone Playwright Node.js script located in `scripts/browser-agent.mjs`.
- Claude Code can invoke this script via `Bash` / `PowerShell`:
  `node scripts/browser-agent.mjs --action send --message "[C2C] STATE: INIT..."`
- The script manages the browser profile, handles ChatGPT DOM input/output, and outputs the reply JSON to stdout for Claude Code to parse.

---

### 4.6 Agents & Subagent Architecture

Claude Code provides a dedicated subagent engine (`.claude/agents/*.md` and `Agent` tool). We define two specialized agent roles:

```
.claude/agents/
├── c2c-executor.md          # Dedicated agent for applying ChatGPT plans
└── c2c-evaluator.md         # Dedicated agent for benchmark comparison
```

#### `c2c-executor.md` Specification
```yaml
---
name: c2c-executor
description: Execute code modifications according to a C2C PLAN message from ChatGPT.
model: sonnet
tools:
  - Bash
  - PowerShell
  - Edit
  - Write
  - Read
  - Glob
  - Grep
isolation: worktree
---
You are the execution subagent for Claude with ChatGPT.
Your task is to implement the ACTIONS described in the C2C PLAN message.
1. Inspect the relevant files.
2. Apply the minimal necessary edits.
3. Run tests using Bash/PowerShell.
4. Format changes and ensure no regressions.
5. Exit cleanly with a structured summary of changed files and test outcomes.
```

---

## 5. Protocol State Machine

The control protocol between Claude Code and ChatGPT remains strictly structured:

```
 ┌──────────────┐
 │  STATE: INIT │ (Claude Code -> ChatGPT: Task Goal & Scope)
 └──────┬───────┘
        ▼
 ┌──────────────┐
 │  STATE: PLAN │ (ChatGPT -> Claude Code: Actions, Files, Rationale, Tests)
 └──────┬───────┘
        ▼
 ┌──────────────────┐
 │ STATE: EXECUTING │ (Claude Code local execution: Edit / Test / Fix)
 └──────┬───────────┘
        ▼
 ┌─────────────────┐
 │ STATE: EXECUTED │ (Claude Code -> ChatGPT: Iteration summary, outputId)
 └──────┬──────────┘
        ▼
 ┌────────────────┐
 │ STATE: REVIEW  │ (ChatGPT inspects workspace via MCP: git_diff, execution_output)
 └──────┬─────────┘
        ├─────────────────────────────┬──────────────────────────┐
        ▼                             ▼                          ▼
 ┌──────────────┐              ┌──────────────┐           ┌───────────────┐
 │  STATE: DONE │              │  STATE: PLAN │           │ STATE: BLOCKED│
 │ (Success)    │              │ (Next Iter)  │           │ (Needs Help)  │
 └──────────────┘              └──────────────┘           └───────────────┘
```

### Local Session Checkpoint States (Session File Only)
To ensure resilience across CLI restarts, `.claude-with-chatgpt` persists:
- `INIT`: INIT dispatched; waiting for PLAN.
- `PLAN_RECEIVED`: PLAN received; execution underway.
- `EXECUTING`: Local edits in progress.
- `EXECUTED_LOCAL`: Edits and tests finished; local record appended.
- `EXECUTED_SENT`: EXECUTED notification sent to ChatGPT; awaiting review.
- `DONE` / `BLOCKED`: Terminal states.

---

## 6. Migration Guide: Codex to Claude Code

### Step-by-Step Codebase Refactoring

```
                               MIGRATION FLOW
                               
   [Codex Codebase]                                   [Claude Code Target]
  ──────────────────                                 ──────────────────────
  skill/SKILL.md                ──Refactor──►        .claude/skills/claude-with-chatgpt/SKILL.md
  src/config/sandbox-allow.ts   ──Replace───►        src/config/claude-settings.ts (JSON)
  ~/.codex/config.toml          ──Replace───►        .claude/settings.json
  control-in-app-browser        ──Replace───►        Guided Manual + browser-agent.mjs
  bin/c2c.js                    ──Update────►        c2c doctor / c2c config-allow / c2c session
```

1. **Rename & Rebrand**:
   - Update `package.json`: name `claude-code-with-chatgpt`, description: `"ChatGPT thinks. Claude works."`.
   - Update `src/version.ts`: `PRODUCT_NAME = "Claude with ChatGPT"`.
2. **Settings Mutator Replacement**:
   - Replace `src/config/sandbox-allow.ts` (which manipulated TOML files) with `src/config/claude-settings.ts`.
   - The new module reads `.claude/settings.json` (or `~/.claude/settings.json`), merges `permissions.allow`, `permissions.additionalDirectories`, and `sandbox.filesystem.allowWrite`, and writes back clean JSON.
3. **Skill Packaging**:
   - Move `skill/SKILL.md` to `.claude/skills/claude-with-chatgpt/SKILL.md`.
   - Strip all references to `agent.browsers.get("iab")`, `tab.markHandoff()`, and `control-in-app-browser`.
   - Add clear Guided Manual instructions with exact ChatGPT deep URLs.
4. **Hooks Provisioning**:
   - Provide a template `.claude/settings.json` in `examples/claude-settings.json` containing default allow rules and lifecycle hooks.
5. **Validation & Verification**:
   - Run unit test suite: `pnpm test`.
   - Verify MCP server endpoints: `workspace_info`, `read_file`, `git_diff`, `execution_output`.

---

## 7. Concrete Next Steps & Action Plan

1. **Phase 1: Configuration & CLI Updates**
   - Implement `src/config/claude-settings.ts` to manage `.claude/settings.json`.
   - Update CLI command `c2c config-allow` (aliasing `sandbox-allow`).
   - Update `paths.ts` to reflect `claude-with-chatgpt` state directories.

2. **Phase 2: Skill Refactoring**
   - Author `.claude/skills/claude-with-chatgpt/SKILL.md`.
   - Author `references/protocol.md`, `references/guided-setup.md`, and `references/recovery.md`.

3. **Phase 3: Agent & Hook Templates**
   - Add `.claude/agents/c2c-executor.md`.
   - Add `.claude/settings.json` hook configurations for test auto-recording.

4. **Phase 4: Optional Automation & Visuals**
   - Implement `scripts/browser-agent.mjs` using Playwright for automated browser interactions.
   - Implement an HTML Artifact template for the visual connection card.

5. **Phase 5: Test Suite Updates**
   - Update `tests/sandbox-allow.test.ts` to `tests/claude-settings.test.ts`.
   - Verify full test suite passes with `pnpm test`.
