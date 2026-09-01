# C2C Agent Protocol

> **Core Invariant**: Control plane and Data plane must never mix.  
> Control messages carry state transitions (< 1 KB). The Data plane (MCP) carries code, search results, and diffs.

---

## Architecture Overview

```
Claude Code CLI (Local Executor) ◄──────[Control Plane: < 1 KB]──────► ChatGPT Web (Planning / Review Brain)
               │                                                                    ▲
               │                                                                    │
               └──────────► Local Workspace ◄──────[Data Plane: Read-Only MCP]──────┘
```

---

## State Machine

```
INIT ──► PLAN ──► EXECUTING ──► EXECUTED ──► REVIEW ──► ( PLAN | DONE | BLOCKED | ERROR )
```

### Protocol Wire States

| State | Sender | Semantic Meaning |
| :--- | :--- | :--- |
| `INIT` | Claude Code | Initializes a task; provides user goal and requests ChatGPT to inspect workspace via MCP and formulate an executable plan. |
| `PLAN` | ChatGPT | Provides a concrete, step-by-step implementation plan with file-level rationales, risks, and test targets. |
| `EXECUTING` | Claude Code | (Optional notification) Signals that local code edits and tests are currently underway. |
| `EXECUTED` | Claude Code | Notifies that an iteration has finished executing locally. Contains only metadata (changed file count, test outcome summary, execution record ID). |
| `REVIEW` | ChatGPT | (Implicit/Explicit) ChatGPT queries MCP (`git_diff`, `read_file`, `execution_output`) to independently audit implementation quality. |
| `DONE` | ChatGPT | Success criteria have been verified against the actual workspace diff. Task complete. |
| `BLOCKED` | ChatGPT | Progress cannot continue due to missing external information, environmental errors, or architectural contradictions. |
| `ERROR` | Either | Protocol, bridge, or infrastructure failure. |
| `HANDOFF` | Claude Code | Continuation brief sent to a newly initialized or replacement ChatGPT chat. |
| `INIT_P` | Claude Code | Mode P fallback for ChatGPT Plus/Free: delivers bounded, sanitized workspace trees and snippets for planning. |
| `EXECUTED_P` | Claude Code | Mode P fallback for ChatGPT Plus/Free: delivers bounded, sanitized git diffs and test logs for review. |

---

## Plan Capability & Operational Invariants

1. **MCP Mode (Mode C / Mode A)**:
   - Supported on **ChatGPT Pro, Team, Enterprise, Edu, and Business** plans.
   - Requires Developer Mode / Custom Apps in ChatGPT Web.
   - **Important Web UX Invariant**: In ChatGPT Web conversations, selecting or `@mentioning` the C2C app (`@Claude Code with ChatGPT`) in the prompt composer is required per turn whenever fresh MCP tool executions are needed.
   - Control messages stay strictly under 1 KB.

2. **Mode P (Plus Manual Context Handoff)**:
   - Designed truthfully for **ChatGPT Plus** ($20/mo) and Free plans where custom MCP server endpoints are unavailable.
   - Explicitly discloses: `[C2C Mode P: MCP is unavailable on this plan; using manual context fallback.]`
   - Zero cookie scraping, zero credential spoofing, zero plan bypass.
   - Bounded context invariants: Tree <= 100 entries (depth <= 3), file snippets <= 200 lines / 16 KB, diff <= 200 lines / 24 KB, total bundle <= 48 KB.
   - All snippets and diffs pass through `IgnoreRules` (sensitive files blocked) and `sanitizeExecutionOutput` (API keys, bearer tokens, and home paths redacted).

---

## Local Checkpoint States (Session Only)

To survive terminal restarts, CLI interrupts, and context resets, the C2C bridge maintains local session checkpoints (`c2c session`). These values are internal to the local executor and are never sent as raw ChatGPT protocol wire headers:

| Local Checkpoint | Meaning |
| :--- | :--- |
| `INIT` | `INIT` sent to ChatGPT; awaiting `PLAN`. |
| `PLAN_RECEIVED` | `PLAN` received from ChatGPT; execution not yet complete. |
| `EXECUTING` | Claude Code is applying file changes and executing test suites. |
| `EXECUTED_LOCAL` | Code changes and test runs completed and recorded (`c2c record`); `EXECUTED` message not yet dispatched. |
| `EXECUTED_SENT` | `EXECUTED` message dispatched; awaiting ChatGPT review. |
| `DONE` / `BLOCKED` | Terminal state. Completed tasks clear checkpoints via `c2c session set --clear-checkpoint`. |

---

## Message Formats & Templates

Every control message uses structured `[C2C]` headers and sections. **Invariants**:
- All control messages must stay strictly under 1 KB.
- Never paste file contents, git diffs, stack traces, or terminal logs into control messages.
- ChatGPT pulls necessary content on demand via read-only MCP tools.

### 1. INIT (Claude Code → ChatGPT)

```text
[C2C]
STATE: INIT
TASK_ID: c2c_f81a
ITERATION: 0
EXECUTOR: claude-code

GOAL:
Implement dark mode toggle with local storage persistence.

INSTRUCTION:
Inspect the connected workspace through the Claude Code with ChatGPT MCP connector.
Produce an actionable C2C PLAN message.
```

### 2. PLAN (ChatGPT → Claude Code)

```text
[C2C]
STATE: PLAN
TASK_ID: c2c_f81a
ITERATION: 1

GOAL:
Add ThemeContext and ThemeToggle component with persistence.

RATIONALE:
The application uses React with Tailwind. A ThemeProvider context wrapping the root app will allow seamless class-based dark mode toggling.

ACTIONS:
1. Create `src/context/ThemeContext.tsx` implementing `ThemeProvider` and `useTheme`.
2. Update `src/App.tsx` to wrap children with `ThemeProvider`.
3. Create `src/components/ThemeToggle.tsx` for the UI switch.
4. Add unit tests for theme switching and localStorage sync.

FILES_LIKELY_INVOLVED:
- src/context/ThemeContext.tsx
- src/App.tsx
- src/components/ThemeToggle.tsx
- tests/ThemeContext.test.tsx

TESTS:
pnpm test tests/ThemeContext.test.tsx

SUCCESS_CRITERIA:
- Theme toggles between light and dark without UI flash.
- Selected theme persists across browser reloads.
- Unit tests pass 100%.
```

### 3. EXECUTED (Claude Code → ChatGPT)

```text
[C2C]
STATE: EXECUTED
TASK_ID: c2c_f81a
ITERATION: 1
EXECUTOR: claude-code

RESULT:
Execution finished. Files created and unit tests executed.

CHANGED_FILES:
4

TESTS:
4 passed, 0 failed

RECORD_ID:
rec_7b92a1

Please independently inspect the workspace and current git diff through MCP.
If execution_output lists a readable item for this iteration, list then read it.
If status is restricted, ignore it and review from git_diff.
```

Before sending `EXECUTED`, Claude Code logs the iteration locally:
```bash
c2c record --task c2c_f81a --iteration 1 --changed-files "src/context/ThemeContext.tsx,src/App.tsx,src/components/ThemeToggle.tsx,tests/ThemeContext.test.tsx" --tests "4 passed, 0 failed" --exit-status ok --command "pnpm test" --output-file /tmp/test-run.log
```

### 4. DONE / BLOCKED (ChatGPT → Claude Code)

```text
[C2C]
STATE: DONE
TASK_ID: c2c_f81a
ITERATION: 1

SUMMARY:
Verified `git_diff` and `execution_output`. The `ThemeContext` implementation correctly handles localStorage hydration and matches Tailwind dark mode conventions. All 4 unit tests pass.
```

```text
[C2C]
STATE: BLOCKED
TASK_ID: c2c_f81a
ITERATION: 2

REASON:
Conflicting styling libraries detected. Workspace contains both Tailwind CSS and styled-components without unified theming tokens.

NEEDS:
Clarification from the user on which styling framework should take precedence for the dark mode color palette.
```

### 5. HANDOFF (Claude Code → New ChatGPT Conversation)

When switching conversations or recovering a lost session, Claude Code transmits a compact summary brief:

```text
[C2C]
STATE: HANDOFF
TASK_ID: c2c_f81a
ITERATION: 2
EXECUTOR: claude-code

ORIGINAL_GOAL:
Implement dark mode with persistent user preferences.

PROGRESS:
- Iteration 1: Context and toggle components implemented.
- Review feedback: Identified flash of incorrect theme during hydration.

CURRENT_STATE:
EXECUTED (Hydration inline script added, pending review).

KNOWN_ISSUES:
Hydration script needs verification against SSR render pipeline.

NEXT_EXPECTED_STEP:
Independently review iteration 2 via `git_diff` and reply PLAN or DONE.
```

---

## Boot Prompt Template

Send once when starting a new ChatGPT conversation or binding a workspace:

```text
You are the planning and review layer of a Claude Code collaborative session.

Claude Code owns local execution (editing, shell commands, test execution, git).
You own high-level reasoning, architectural planning, and code review.

You have access to the current local workspace through the "Claude Code with ChatGPT" read-only MCP connector.

Operational Rules:
1. Do not ask Claude Code to paste files or diffs that are accessible via MCP.
2. Inspect only the files necessary for the assigned task.
3. Use MCP tools (`workspace_info`, `read_file`, `search_workspace`, `git_status`, `git_diff`, `execution_output`) to inspect the project.
4. Produce concise, actionable, executable plans.
5. Claude Code will execute your plan using its local harness and record outcomes.
6. After Claude Code reports EXECUTED, independently inspect `git_diff` and `execution_output`.
7. Do not assume an implementation succeeded purely on verbal claims; verify actual diffs.
8. Continue iterations until success criteria are completely satisfied.
9. Avoid unnecessary broad refactoring or rewrites.
10. Return strictly formatted C2C structured control messages.
11. If you receive a HANDOFF message, trust the brief for historical context, re-read code via MCP, and resume from NEXT_EXPECTED_STEP.
```

---

## Project Instructions (ChatGPT Custom Instructions)

For persistent ChatGPT Projects bound to a workspace, paste into **Project Settings → Instructions**:

```text
You are the planning and review layer for local workspace: {{workspace_name}}
Local Executor: Claude Code CLI

Bound Connector: {{connector_name}}

Rules:
1. When invoking tools, use ONLY the connector specified above.
2. Read code, directory trees, git diffs, and test outputs exclusively through that connector.
3. Never request the user or Claude Code to paste raw source files or logs.
4. After receiving [C2C] STATE: EXECUTED, call `execution_output` and `git_diff` to verify changes.
5. Trust precedence on conflicting information:
   (1) Current live code via MCP connector
   (2) HANDOFF message in current conversation
   (3) These Project instructions
   (4) Project-level memory
6. Output replies using standard [C2C] control structures.
```
