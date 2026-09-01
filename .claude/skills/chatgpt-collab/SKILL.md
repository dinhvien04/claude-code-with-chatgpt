---
name: chatgpt-collab
description: Collaborate with ChatGPT Web for high-level reasoning while Claude Code executes
---

# ChatGPT Collaboration (`chatgpt-collab`)

ChatGPT thinks. Claude Code works.

Claude Code owns execution: editing, shell commands, git operations, tests, and recovery.
ChatGPT owns high-level reasoning: system architecture, task planning, code review, and debug strategy.
The C2C Bridge gives ChatGPT read-only MCP access to the current workspace over a secure tunnel, so control messages between Claude Code and ChatGPT stay tiny (< 1 KB) — ChatGPT pulls whatever codebase context or git diffs it needs independently.

---

## 1. Core Principles & Golden Rules

1. **Dual-Plane Separation**:
   - **Control Plane (< 1 KB)**: High-level state transitions and goals exchanged via copyable `[C2C]` blocks.
   - **Data Plane (MCP)**: Code reads, directory listings, git diffs, and execution output inspected directly by ChatGPT over Model Context Protocol (MCP).
2. **Never Paste Big Content**: NEVER paste whole file contents, large git diffs, or execution logs into ChatGPT. ChatGPT reads them through the 9 read-only MCP tools.
3. **Keep ChatGPT Read-Only**: ChatGPT never has write, execution, or mutation permissions. All changes are verified and executed by Claude Code locally.
4. **Standard Default: Mode C (Guided Manual Handoff)**:
   - Mode C is the primary, 100% reliable default workflow across all operating systems.
   - Claude Code outputs structured, single-click copyable `[C2C]` prompt blocks.
   - The user pastes into ChatGPT Web and copies ChatGPT's responses back.
   - Mode A (optional automation script via `scripts/browser-agent.mjs`) is an auxiliary helper that immediately falls back to Mode C if any login wall, CAPTCHA, or Turnstile check appears.
5. **Doctor Gate**: Before starting any task or handoff, ensure `c2c doctor` is green.

---

## 2. Setup & Pairing Workflow

### Prerequisites
- Node.js >= 20
- `cloudflared` installed (`brew install cloudflared` on macOS, `winget install Cloudflare.cloudflared` on Windows, or package manager on Linux)
- For **Mode C / Mode A (MCP Mode)**: A ChatGPT Pro, Team, Enterprise, Edu, or Business account with Developer Mode / Custom Apps enabled.
- For **Mode P (Manual Context Fallback)**: ChatGPT Plus or Free accounts (OpenAI restricts custom MCP server connectors to Pro, Team, Enterprise, Edu, and Business).

### Step 1: Initialize Workspace Bridge & Permissions
In your target workspace, ensure required permissions and sandbox state paths are configured, then launch the bridge:
```bash
c2c config-allow -w .
c2c setup -w .
```
This configures `.claude/settings.local.json` (auto-approved commands and state directory write path), starts the local C2C bridge daemon, opens the Cloudflare tunnel, and prints:
- `mcpUrl`: The public HTTPS endpoint for ChatGPT Custom Action / Connector (e.g. `https://xxx.trycloudflare.com/mcp`).
- `pairingCode`: An 8-character CSPRNG one-time code (valid for 5 minutes).
- `connectorName`: The suggested connector title (e.g. `Claude Code with ChatGPT · <workspace>`).

### Step 2: Configure ChatGPT Connector (Mode C)
Guide the user through these steps:
1. Open ChatGPT Web -> **Settings** -> **Apps** (or **Developer Mode**).
2. Click **Add Custom App / Connector** (or visit `https://chatgpt.com/#settings/Apps`).
3. Enter:
   - **Name**: `<connectorName>` (from setup output, e.g. `Claude Code with ChatGPT`)
   - **Description**: `Secure read-only workspace bridge for Claude Code planning and review.`
   - **Server URL**: `<mcpUrl>`
   - **Authentication**: `OAuth`
4. Click **Connect / Authorize**. The browser will open the C2C OAuth pairing page.
5. Enter the **Pairing Code** and confirm authorization.
6. Once connected, ChatGPT has secure read-only MCP access to the workspace.
7. **Important UX Note**: In ChatGPT Web conversations, ensure you select or `@mention` the registered connector app (`@Claude Code with ChatGPT`) in each prompt turn requiring fresh MCP tool inspections.

---

## 3. Dual-Plane Protocol & State Machine

```
INIT ───► PLAN ───► EXECUTING ───► EXECUTED ───► REVIEW ───► PLAN (next iteration)
                                                               │
                                                               ├──► DONE
                                                               └──► BLOCKED
```

| Wire State | Sender | Meaning |
| :--- | :--- | :--- |
| `INIT` | Claude Code | New task initialized; requests ChatGPT to inspect codebase and produce `PLAN`. |
| `PLAN` | ChatGPT | High-level architectural plan, file suggestions, tests, and success criteria. |
| `EXECUTING` | Claude Code | Execution underway in Claude Code (local checkpoint state). |
| `EXECUTED` | Claude Code | Iteration finished; summarizes changed files, test counts, and pointers. |
| `REVIEW` | ChatGPT | (Implicit) ChatGPT inspects workspace & `git_diff` via MCP tools. |
| `DONE` | ChatGPT | All task goals and success criteria verified and satisfied. |
| `BLOCKED` | ChatGPT | Blocked by missing requirement, external dependency, or critical ambiguity. |
| `HANDOFF` | Claude Code | Context handoff brief when switching or recovering a ChatGPT conversation. |

---

## 4. Prompt Templates

### A. Boot Prompt (First message in a ChatGPT Project or Chat)
```text
You are the planning and review intelligence for a local repository being developed with Claude Code.
Claude Code owns all file modifications, shell execution, testing, and git operations.
You have read-only MCP access to inspect the repository (tools: workspace_info, read_file, list_directory, search_workspace, git_status, git_diff, test_status, execution_summary, execution_output).

Protocol rules:
1. Read code, diffs, and execution output directly through MCP tools. Never ask the user to paste code or logs.
2. Reply using structured [C2C] control blocks (STATE: PLAN, DONE, BLOCKED).
3. Focus on architecture, correctness, edge cases, and verification criteria.
```

### B. `INIT` Prompt (Claude Code -> ChatGPT)
```text
[C2C]
STATE: INIT
TASK_ID: c2c_<hex4>
ITERATION: 0

GOAL:
<Clear, concise description of what needs to be implemented or fixed>

INSTRUCTION:
1. Call `workspace_info` and inspect relevant files via MCP tools.
2. Formulate a structured C2C PLAN with rationale, actions, affected files, tests, and success criteria.
```

### C. `PLAN` Response (ChatGPT -> Claude Code)
```text
[C2C]
STATE: PLAN
TASK_ID: c2c_<hex4>
ITERATION: 1

GOAL:
<Refined goal statement>

RATIONALE:
<Architectural justification and approach>

ACTIONS:
1. <Step 1: File and change description>
2. <Step 2: File and change description>

FILES_LIKELY_INVOLVED:
- src/path/to/file1.ts
- src/path/to/file2.ts

TESTS:
- <Test cases or commands to validate>

SUCCESS_CRITERIA:
- <Concrete acceptance checks>
```

### D. `EXECUTED` Prompt (Claude Code -> ChatGPT)
```text
[C2C]
STATE: EXECUTED
TASK_ID: c2c_<hex4>
ITERATION: 1

RESULT:
Execution completed.

CHANGED_FILES:
<Count of modified files, e.g. 3>

TESTS:
<Summary of test results, e.g. 14 passed, 0 failed>

Please inspect the git diff and workspace via MCP. If execution_output contains relevant logs, inspect it.
Reply with STATE: DONE if satisfied, STATE: PLAN for the next iteration, or STATE: BLOCKED if an issue cannot be resolved.
```

### E. `HANDOFF` Prompt (For conversation switch / recovery)
```text
[C2C]
STATE: HANDOFF
TASK_ID: c2c_<hex4>
ITERATION: <n>

GOAL:
<Original user goal>

PROGRESS:
<What has been completed so far>

KNOWN_ISSUES:
<Any unresolved problems or notes>

NEXT_EXPECTED_STEP:
<The immediate next action required>

Please call `workspace_info` and `git_diff` through MCP, then continue the review or planning loop.
```

### F. `Mode P` Prompts (ChatGPT Plus / Free — Manual Context Fallback)

When using ChatGPT Plus where custom MCP connectors are unavailable, use Mode P templates:

#### `INIT_P` (Claude Code -> ChatGPT Plus)
```text
[C2C]
STATE: INIT_P
TASK_ID: c2c_<hex4>
ITERATION: 0
EXECUTOR: claude-code
MODE: P (Plus Manual Context Handoff)

NOTICE:
MCP is unavailable for this ChatGPT plan; using manual context fallback.

GOAL:
<Goal description>

WORKSPACE_SUMMARY:
Name: <project_name>
Type: <project_type>

BOUNDED_TREE:
<Bounded directory tree (max 100 entries, depth 3)>

TARGET_SOURCE_SNIPPETS:
=== FILE: <relative_path> ===
<Bounded source code (max 200 lines / 16 KB)>
=== END FILE ===

INSTRUCTION:
Review the provided context bundle and produce a structured [C2C] STATE: PLAN response.
```

#### `EXECUTED_P` (Claude Code -> ChatGPT Plus)
```text
[C2C]
STATE: EXECUTED_P
TASK_ID: c2c_<hex4>
ITERATION: 1
EXECUTOR: claude-code
MODE: P (Plus Manual Context Handoff)

NOTICE:
MCP is unavailable for this ChatGPT plan; using manual context fallback.

RESULT:
Execution completed.

CHANGED_FILES:
- <file_1>
- <file_2>

SANITIZED_TESTS:
<Test results summary>

BOUNDED_GIT_DIFF:
<Sanitized git diff (capped at 24 KB / 200 lines)>

INSTRUCTION:
Audit the diff and test execution output. Reply with [C2C] STATE: DONE if satisfied, or STATE: PLAN for the next iteration.
```

---

## 5. Execution Checkpoint Workflows

Claude Code tracks local checkpoints using `c2c session` to guarantee idempotent recovery and avoid duplicate work:

```bash
# Update local session checkpoint
c2c session set -w . --task c2c_a1b2 --iteration 1 --state EXECUTED --protocol-state EXECUTED_LOCAL
```

### Checkpoint State Transition Table
1. **`INIT`**: Claude Code generated `[C2C] STATE: INIT`. Waiting for user to paste ChatGPT's `PLAN`.
2. **`PLAN_RECEIVED`**: Plan received. Claude Code parses action items and begins implementation.
3. **`EXECUTING`**: Claude Code is editing files, running builds, executing tests.
4. **`EXECUTED_LOCAL`**: Local changes completed and tested. Claude Code records output:
   ```bash
   c2c record -w . --task c2c_a1b2 --iteration 1 --changed-files "src/a.ts,src/b.ts" --tests "12 passed" --exit-status ok
   ```
5. **`EXECUTED_SENT`**: `[C2C] STATE: EXECUTED` prompt generated for ChatGPT review. Waiting for ChatGPT `PLAN` or `DONE`.
6. **`DONE`**: Goal reached. Claude Code clears session checkpoint:
   ```bash
   c2c session set -w . --state DONE --clear-checkpoint
   ```
7. **`BLOCKED`**: Ambiguity or issue surfaced; Claude Code presents the blocker to the user.

---

## 6. Recovery & Troubleshooting Map

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| `c2c doctor` reports Bridge down | Daemon stopped or port occupied | Run `c2c start -w .` or `c2c doctor -w . --fix`. |
| ChatGPT MCP tool calls return 401 | OAuth token expired or revoked | Run `c2c pair -w .` to obtain a fresh pairing code, then authorize in ChatGPT. |
| Tunnel URL unreachable | Cloudflare Quick Tunnel restarted | Run `c2c doctor -w .` to obtain the new URL; in ChatGPT update or re-add the connector. |
| Pairing code expired | Codes expire after 5 minutes | Run `c2c pair -w . --json` to generate a new code immediately. |
| CAPTCHA / Cloudflare Turnstile | Automated browser blocked | Fall back immediately to **Mode C (Guided Manual Handoff)**. |
