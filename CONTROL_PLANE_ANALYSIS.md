# Control Plane Investigation & Architecture Analysis

## 1. Executive Summary

This document presents a comprehensive technical investigation into the control plane architecture of `codex-with-chatgpt` (C2C) and evaluates its portability and execution capabilities within the **Claude Code CLI** environment.

### Core Architectural Finding
The upstream `codex-with-chatgpt` system enforces a strict dual-plane separation:
1. **Data Plane (MCP)**: Powered by a local Node.js / Express bridge exposing a read-only Model Context Protocol (MCP) server over a secure Cloudflare Tunnel (Quick or Named) with OAuth 2.1 PKCE authentication and dynamic client registration. ChatGPT queries workspace state, files, git diffs, and test outputs directly via this data plane.
2. **Control Plane (Agent-to-Agent Reasoning Protocol)**: Designed upstream to exchange lightweight (< 1 KB) structured `[C2C]` messages (`INIT`, `PLAN`, `EXECUTED`, `REVIEW`, `DONE`, `BLOCKED`) inside the ChatGPT Web UI.

Upstream implemented the control plane assuming an OpenAI Codex-specific in-app browser environment (`control-in-app-browser` via Playwright/DOM automation). In contrast, the standard **Claude Code CLI** environment is a terminal-based agent without a native embedded browser engine.

### Strict Security and Compliance Guarantees
To maintain security integrity and adhere strictly to ethical and platform boundaries, this architecture categorically prohibits:
- Extracting ChatGPT session cookies or scraping authentication tokens.
- Stealing browser session state or profile directories.
- Converting ChatGPT Plus/Pro subscriptions into unauthorized unofficial APIs.
- Reverse-engineering internal ChatGPT web endpoints (`/backend-api/...`).
- Introducing browser credential hacks or memory injection.

Interaction with ChatGPT must strictly follow official channels: either legitimate user interactions in the official web interface or standardized OAuth 2.1 MCP tool connectivity.

---

## 2. Upstream Architecture and Intended Interaction Loop

### 2.1 Upstream Interaction Diagram

```
                 +-----------------------------------+
                 |           ChatGPT Web             |
                 |     Reason / Plan / Review        |
                 +-----------------+-----------^-----+
                                   |           |
                          MCP      |           | Control Plane
                       Data Plane  |           | ([C2C] Structured Messages)
                                   v           |
                 +-----------------------------+-----+
                 |              C2C Bridge           |  (Local Node.js Daemon)
                 |  - Read-Only MCP Server (9 Tools) |  (127.0.0.1:48765)
                 |  - OAuth 2.1 AS + PRM Discovery   |  (Cloudflare Tunnel HTTPS)
                 |  - CSPRNG 5-min Pairing Manager   |
                 +-----------------+-----------------+
                                   | read-only
                                   v
+-----------------------+     +----+----------------+
|      Codex Harness    |---->|   Local Workspace   |
| (Edit/Shell/Git/Test) |     +---------------------+
+-----------------------+
```

### 2.2 Upstream Control Plane Mechanics
In OpenAI Codex, the skill `codex-with-chatgpt` relied on the internal `control-in-app-browser` API:
- `setupBrowserRuntime()`: Initialized a browser instance within the Codex process.
- `agent.browsers.get("iab")`: Acquired the in-app browser handle.
- DOM scripting: Automatically navigated to `https://chatgpt.com/#settings/Security`, `https://chatgpt.com/plugins`, created the connector, typed the 8-character pairing code into the OAuth pairing page, and pasted `[C2C]` messages into the active chat composer.
- Polling: Executed periodic DOM inspection (every 20 to 30 seconds) to detect when ChatGPT finished generating its structured response (`STATE: PLAN` or `STATE: DONE`).

### 2.3 Protocol State Machine
The upstream protocol defines a deterministic state transition loop:

```
[INIT] (Codex -> ChatGPT)
  |
  v
[PLAN] (ChatGPT -> Codex via Web UI)
  |
  v
[EXECUTING] (Local Harness: File Edits, Tests, Diff Inspection)
  |
  v
[EXECUTED] (Codex -> ChatGPT: changed files count, test summary, MCP pointer)
  |
  v
[REVIEW] (ChatGPT calls MCP: git_diff, read_file, execution_output)
  |
  +---> [PLAN] (Next iteration if issues found)
  |
  +---> [DONE] (Success criteria verified)
  |
  +---> [BLOCKED] (Unresolvable conflict or user decision required)
```

Throughout this loop, file contents, full diffs, and execution logs are **never** pasted into the control plane messages. ChatGPT independently fetches all necessary data via MCP tools.

---

## 3. Environment Audit: Claude Code CLI vs Upstream Codex

### 3.1 Claude Code CLI Native Capabilities
Claude Code provides powerful primitives for local development and workflow automation:

| Capability Domain | Available Primitives in Claude Code | Status in C2C System |
|---|---|---|
| **Process Management** | `Bash`, `PowerShell`, `Monitor`, `TaskStop` | Full capability to launch, inspect, and manage the `c2c` daemon, bridge server, and `cloudflared` background processes. |
| **Filesystem & Code Manipulation** | `Read`, `Write`, `Edit`, `Glob`, `Grep` | Native capability to perform workspace code editing, patch application, and configuration persistence. |
| **Static Web Retrieval** | `WebFetch`, `WebSearch` | Can fetch static public HTTP resources and query search indexes. Cannot execute dynamic client-side JavaScript or drive interactive Single Page Applications (SPAs). |
| **Agent Coordination** | `Agent`, `SendMessage` | Can coordinate multi-agent subtasks locally within Claude Code. |
| **Local MCP Server Hosting** | Node.js runtime (`node >= 20`), `pnpm` | Fully capable of hosting the C2C bridge HTTP server and MCP endpoints. |

### 3.2 Key Divergences and Absent Capabilities
The standard Claude Code environment differs from OpenAI Codex in several critical ways:
1. **No Embedded In-App Browser Engine**: Claude Code does not bundle an internal Playwright/Chromium runtime or provide an `agent.browsers` JavaScript object.
2. **No Native OS Screen / DOM Control**: Standard Claude Code operates inside a terminal emulator and does not possess direct mouse click or DOM selector automation tools for third-party desktop windows unless an external automation MCP server is explicitly installed by the user.
3. **Sandbox and Session Boundary**: Claude Code executes tool actions within its permission model and does not inject code into arbitrary running user processes.

---

## 4. Feasibility Matrix: Automated vs Manual

| Feature / Subsystem | Execution Method | Automatable in Claude Code? | Requirement & Dependency |
|---|---|---|---|
| **Bridge Daemon Management** | CLI / Background Process | Yes (100% Automated) | Node.js >= 20, `c2c start`, `c2c stop`, `c2c doctor` |
| **Cloudflare Tunnel Setup** | CLI (`cloudflared`) | Yes (100% Automated) | Quick tunnel: zero config.<br>Named tunnel: one-time user browser login. |
| **OAuth 2.1 AS & Pairing Engine** | C2C Bridge Engine | Yes (100% Automated) | Handled natively by Express server in `src/auth/` and `src/pairing/`. |
| **MCP Tool Service (Data Plane)** | Streamable HTTP / JSON-RPC | Yes (100% Automated) | ChatGPT accesses `https://<tunnel-domain>/mcp` directly. |
| **Local Task Execution** | Claude Code Tools | Yes (100% Automated) | Claude edits files, runs tests, and calls `c2c record`. |
| **Execution Sanitization** | `src/execution/sanitize.ts` | Yes (100% Automated) | Redacts secrets and token hashes before releasing logs to MCP. |
| **Session & Checkpointing** | `c2c session` CLI | Yes (100% Automated) | State written to `%LOCALAPPDATA%/codex-with-chatgpt` or OS equivalent. |
| **ChatGPT Connector Creation** | ChatGPT Web Settings | Conditional / Manual | **Mode A**: External browser automation.<br>**Mode C**: User creates connector once via URL. |
| **OAuth Pairing Code Entry** | Browser Form Submission | Conditional / Manual | **Mode A**: External browser automation.<br>**Mode C**: User enters 8-character code in browser. |
| **Control Plane Message Exchange** | ChatGPT Chat Input/Output | Conditional / Manual | **Mode A**: External browser automation.<br>**Mode C**: User copies formatted prompt from Claude to ChatGPT, and pastes reply back. |

---

## 5. Design of the ControlPlaneAdapter Abstraction

To ensure clean architecture, high reliability, and clear separation of concerns, the control plane interaction must be encapsulated behind a modular `ControlPlaneAdapter` interface.

```
                         +-----------------------------+
                         |     ControlPlaneAdapter     |
                         |         (Interface)         |
                         +--------------+--------------+
                                        |
         +------------------------------+------------------------------+
         |                                                             |
         v                                                             v
+------------------------------------+               +------------------------------------+
|               Mode A               |               |               Mode C               |
|      Verified Browser / UI         |               |     Documented Manual Fallback     |
|             Automation             |               |      (Zero-Dependency Default)     |
+------------------------------------+               +------------------------------------+
| - Probes for Playwright / CDP / MCP|               | - Outputs formatted [C2C] prompts  |
| - Strictly scoped to chatgpt.com   |               | - Provides one-click copy blocks   |
| - Never dumps tokens or cookies    |               | - Ingests and parses pasted replies|
| - Safe DOM typing and polling      |               | - Deterministic state checkpoints  |
+------------------------------------+               +------------------------------------+
                                        |
                                        v
                         +-----------------------------+
                         |           Mode B            |
                         |   Verified Connector / MCP  |
                         +-----------------------------+
                         | - ChatGPT Actions / Webhook |
                         | - Remote MCP over Tunnel    |
                         | - Autonomous Data Retrieval |
                         +-----------------------------+
```

### 5.1 TypeScript Interface Specification

```typescript
export type ControlPlaneMode = "automation" | "connector" | "manual";

export interface ControlMessage {
  state: "INIT" | "EXECUTED" | "HANDOFF";
  taskId: string;
  iteration: number;
  payload: {
    goal?: string;
    instruction?: string;
    result?: string;
    changedFilesCount?: number;
    testsSummary?: string;
    customFields?: Record<string, string>;
  };
}

export interface ControlResponse {
  state: "PLAN" | "DONE" | "BLOCKED" | "ERROR";
  taskId: string;
  iteration: number;
  rawText: string;
  parsed: {
    goal?: string;
    rationale?: string;
    actions?: string[];
    filesLikelyInvolved?: string[];
    tests?: string[];
    successCriteria?: string[];
    summary?: string;
    reason?: string;
    needs?: string;
  };
}

export interface AdapterCapabilities {
  mode: ControlPlaneMode;
  canAutomateSetup: boolean;
  canAutomateDispatch: boolean;
  canAutomateResponsePolling: boolean;
  description: string;
}

export interface ControlPlaneAdapter {
  readonly mode: ControlPlaneMode;
  
  /** Probe runtime environment to detect if automated browser control is available */
  detectCapabilities(): Promise<AdapterCapabilities>;
  
  /** Guide or automate the initial ChatGPT connector creation and OAuth pairing */
  setupConnector(params: {
    connectorName: string;
    mcpUrl: string;
    pairingCode: string;
  }): Promise<{ success: boolean; requiresUserAction: boolean; instructions?: string }>;
  
  /** Dispatch a [C2C] message (INIT, EXECUTED, HANDOFF) */
  dispatchMessage(msg: ControlMessage): Promise<{
    dispatched: boolean;
    displayPrompt?: string;
  }>;
  
  /** Await or ingest ChatGPT's response */
  receiveResponse(options?: {
    timeoutMs?: number;
    manualInput?: string;
  }): Promise<ControlResponse>;
  
  /** Format a message into the standard RFC-compliant [C2C] text block */
  formatControlPrompt(msg: ControlMessage): string;
  
  /** Parse a raw response text from ChatGPT into structured ControlResponse */
  parseControlResponse(rawText: string): ControlResponse;
}
```

---

### 5.2 Operating Modes Detailed Analysis

#### Mode A: Verified Available Browser/UI Automation
- **Prerequisites**: A verified, user-authorized browser automation tool (such as an external Playwright runner script, a Chrome DevTools Protocol bridge, or a local Browser MCP server).
- **Execution Strategy**:
  1. Verifies that the browser is operating exclusively on `https://chatgpt.com/`.
  2. Performs form filling for OAuth authorization using the ephemeral CSPRNG pairing code.
  3. Enters structured `[C2C]` prompts into the ChatGPT composer.
  4. Polls DOM elements for the completion of ChatGPT reasoning and extracts the response text.
- **Safety Boundaries**:
  - Never touches browser cookies, local storage credentials, or session tokens.
  - Aborts immediately if unexpected third-party domains or login walls appear, escalating to the user with a clear, single-action request.

#### Mode B: Verified Browser MCP / Connector
- **Prerequisites**: ChatGPT Plus/Pro with developer mode and the C2C MCP connector configured via Cloudflare Tunnel.
- **Execution Strategy**:
  - Operates as the data plane backbone.
  - ChatGPT triggers tool invocations (`workspace_info`, `read_file`, `git_diff`, `execution_output`) over the secure OAuth tunnel.
  - The C2C Bridge responds statelessly to JSON-RPC tool requests.
- **Role**:
  - Mode B handles 100% of data flow, eliminating token bloat in control messages.

#### Mode C: Documented Manual Fallback (Primary Claude Code Mode)
- **Prerequisites**: Zero external dependencies beyond Claude Code and `c2c`.
- **Execution Strategy**:
  1. **Connector Setup**: Claude Code runs `c2c setup --json`, generates a 5-minute pairing code and public tunnel URL, and provides the exact URL and 3-step instructions for the user to paste into ChatGPT settings once.
  2. **Task Initiation**: Claude Code formats a clean, copy-paste-ready `[C2C] STATE: INIT` block.
  3. **User Action**: The user pastes the prompt into ChatGPT Web. ChatGPT calls MCP tools in the background and outputs `[C2C] STATE: PLAN`.
  4. **Handoff Back to Claude**: The user pastes ChatGPT's plan back into the Claude Code terminal.
  5. **Autonomous Local Execution**: Claude Code executes file modifications, runs tests, and executes `c2c record`.
  6. **Next Iteration / Verification**: Claude Code outputs `[C2C] STATE: EXECUTED`. The user pastes this to ChatGPT, which verifies diffs via MCP and responds with `DONE` or the next `PLAN`.
- **Advantages**:
  - Completely immune to DOM selector breakage, CAPTCHAs, Cloudflare Turnstile challenges, and UI redesigns.
  - 100% transparent and deterministic.

---

## 6. Security & Anti-Pattern Evaluation

### 6.1 Prohibited Anti-Patterns vs Legitimate Implementation

| Anti-Pattern (Strictly Forbidden) | Risk & Failure Mode | Legitimate Architecture in C2C |
|---|---|---|
| **Extracting ChatGPT Cookies / LocalStorage** | Violates security boundaries; brittle; exposes user accounts to token leakage. | Ephemeral OAuth 2.1 authorization with CSPRNG one-time pairing codes (5-minute TTL, 5-attempt limit). |
| **Scraping Internal ChatGPT APIs (`/backend-api`)** | Breaches terms of service; triggers account bans; breaks on undocumented API changes. | Official ChatGPT Web UI interaction via user interface + standard MCP protocol. |
| **Hardcoding Long-Lived Bearer Credentials** | Permanent credential exposure if logs or files are shared. | Refresh token rotation; SHA-256 token hashing on disk; zero plain-text token persistence. |
| **Injecting Full Code Diffs into Prompts** | Blows context windows; leaks sensitive credentials; causes hallucinated diff parsing. | Read-only MCP data plane where ChatGPT pulls specific lines on demand. |

### 6.2 Data Protection in the Claude Code Environment
- **Path Containment**: Realpath resolution ensures symlink escapes or relative path traversal (`../../`) cannot access files outside the workspace root.
- **Sensitive File Exclusion**: Patterns matching `.env*`, `.git/`, SSH keys, and cloud credentials are hard-blocked by `src/workspace/ignore.ts`.
- **Execution Output Sanitization**: `src/execution/sanitize.ts` automatically strips secret keys, auth headers, and pairing codes before making test/build logs available to `execution_output`.

---

## 7. Operational Workflow for Claude Code

### Step 1: Bridge & Tunnel Initialization
Claude Code executes:
```powershell
node bin/c2c.js setup --json
```
Returns:
- `mcpUrl`: `https://<tunnel-id>.trycloudflare.com/mcp`
- `pairingCode`: `XXXX-XXXX`
- `workspaceName`: Project name

### Step 2: One-Time ChatGPT Connector Configuration (Manual or Guided)
User navigates to:
`https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins`
- Connector Name: `Codex with ChatGPT · <workspaceName>`
- Server URL: `<mcpUrl>`
- Authentication: OAuth
- Pairing Code: `<pairingCode>`

### Step 3: Structured Control Loop Execution
1. **Claude Code emits INIT**:
   ```text
   [C2C]
   STATE: INIT
   TASK_ID: c2c_a1b2
   ITERATION: 0

   GOAL:
   Implement user authentication middleware.

   INSTRUCTION:
   Inspect the connected workspace through MCP and produce a C2C PLAN message.
   ```
2. **ChatGPT processes via MCP**: Calls `workspace_info`, `read_file`, `search_workspace`.
3. **ChatGPT responds with PLAN**:
   ```text
   [C2C]
   STATE: PLAN
   TASK_ID: c2c_a1b2
   ITERATION: 1

   GOAL:
   Implement JWT validation middleware with unit tests.

   ACTIONS:
   1. Create src/auth/jwt-middleware.ts
   2. Register middleware in server router
   3. Add test suite in tests/jwt.test.ts
   ```
4. **Claude Code executes plan**: Modifies code, runs test suite, and records execution:
   ```powershell
   node bin/c2c.js record --task c2c_a1b2 --iteration 1 --changed-files "src/auth/jwt-middleware.ts,tests/jwt.test.ts" --tests "12 passed" --exit-status ok
   ```
5. **Claude Code emits EXECUTED**:
   ```text
   [C2C]
   STATE: EXECUTED
   TASK_ID: c2c_a1b2
   ITERATION: 1

   RESULT:
   Execution finished.

   CHANGED_FILES:
   2

   TESTS:
   12 passed

   Please independently inspect the workspace and current git diff through MCP.
   ```
6. **ChatGPT performs independent review**: Inspects `git_diff` through MCP and emits `[C2C] STATE: DONE`.

---

## 8. Summary of Actionable Conclusions

1. **Native Browser Control Does Not Exist in Default Claude Code**:
   Claude Code CLI lacks an embedded browser automation framework equivalent to Codex's `control-in-app-browser`.
2. **The MCP Data Plane Is 100% Fully Functional**:
   The existing bridge, OAuth 2.1 engine, Cloudflare tunnel management, and 9 read-only MCP tools work seamlessly in Claude Code on Windows, macOS, and Linux.
3. **Mode C (Manual Copy-Paste Fallback) Is the Primary Recommended Control Plane**:
   Mode C delivers maximum reliability, zero security risk, zero brittle DOM dependencies, and preserves the full value proposition of using ChatGPT Plus/Pro web intelligence to guide Claude Code execution.
4. **Architecture Is Extensible**:
   By implementing the `ControlPlaneAdapter` abstraction, external browser automation (Mode A) can be plugged in modularly whenever verified browser automation tools or MCP servers are present in a user's specific environment.
