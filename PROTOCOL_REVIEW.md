# Protocol Implementation Independent Review (C2C Protocol)

**Audit Target:** ChatGPT-to-Code (C2C) Dual-Plane Agent Protocol & Engine Implementation  
**Auditor:** `protocol-reviewer`  
**Date:** 2026-09-01  
**Status:** COMPLETE & INDEPENDENTLY AUDITED  

---

## 1. Executive Summary & Architectural Invariant Assessment

The **C2C (ChatGPT to Code) protocol** implements an asymmetric dual-plane architecture designed for tight collaboration between a high-level planning/review LLM (ChatGPT Web / Projects / Custom Actions) and a local code execution harness (Claude Code CLI / Codex / Custom Agent Harness).

### Core Architectural Invariants:
1. **Strict Plane Separation (`docs/protocol.md:3-5`, `.claude/skills/chatgpt-collab/SKILL.md:18-22`):**
   - **Control Plane (Conversational Push):** Carried across the chat UI. Contains lightweight structured state transitions and task coordination messages strictly constrained to **< 1 KB**. It **never carries source code bodies, full diffs, or raw terminal logs**.
   - **Data Plane (On-Demand MCP Pull):** Carried over a secure, authenticated, read-only Model Context Protocol (MCP) stream over loopback HTTP or HTTPS via Cloudflare Tunnels (`POST /mcp`). ChatGPT queries workspace files, AST/directory trees, git diffs, and execution output on demand.
2. **Read-Only Data Plane (`src/mcp/server.ts:58-326`):**
   - The MCP server exports **exactly 9 read-only tools**.
   - No filesystem write, deletion, arbitrary command execution, or git mutating tools are registered.
3. **Execution Ground Truth vs. Self-Reported Claims (`docs/protocol.md:219-220`, `.claude/skills/chatgpt-collab/SKILL.md:159-161`):**
   - The local executor harness only reports lightweight execution metadata.
   - ChatGPT is mandated by protocol instructions to independently audit code changes via `git_diff` and `execution_output` rather than trusting verbal claims.

---

## 2. State Transitions on the Wire

### 2.1 Wire State Machine Graph
```
           ┌──────────┐
           │   INIT   │ (Claude Code -> ChatGPT)
           └────┬─────┘
                │
                ▼
           ┌──────────┐
      ┌───►│   PLAN   │ (ChatGPT -> Claude Code)
      │    └────┬─────┘
      │         │
      │         ▼
      │    ┌──────────┐
      │    │EXECUTING │ (Claude Code local checkpoint / optional notice)
      │    └────┬─────┘
      │         │
      │         ▼
      │    ┌──────────┐
      │    │ EXECUTED │ (Claude Code -> ChatGPT)
      │    └────┬─────┘
      │         │
      │         ▼
      │    ┌──────────┐
      │    │  REVIEW  │ (Implicit state: ChatGPT invokes MCP tools)
      │    └────┬─────┘
      │         │
      ├─────────┴────────────────┬────────────────┐
      │ (Next Iteration)         │ (Goal Satisfied│ (Blocked / Ambiguous)
      │                          │                │
      ▼                          ▼                ▼
   [ PLAN ]                   [ DONE ]       [ BLOCKED ]
```

### 2.2 Wire State Specifications & Metadata Headers

| Wire State | Initiator | Payload Schema / Required Headers | Semantic Definition |
| :--- | :--- | :--- | :--- |
| `INIT` | Claude Code | `STATE: INIT`<br>`TASK_ID: <id>`<br>`ITERATION: 0`<br>`GOAL:` ...<br>`INSTRUCTION:` ... | Initializes a task; instructs ChatGPT to inspect the workspace via MCP tools (`workspace_info`, `read_file`) and formulate an implementation plan (`docs/protocol.md:65-78`). |
| `PLAN` | ChatGPT | `STATE: PLAN`<br>`TASK_ID: <id>`<br>`ITERATION: <n>`<br>`GOAL:` ...<br>`RATIONALE:` ...<br>`ACTIONS:` ...<br>`FILES_LIKELY_INVOLVED:` ...<br>`TESTS:` ...<br>`SUCCESS_CRITERIA:` ... | Architectural blueprint outlining concrete file modification steps, verification suites, and explicit success criteria (`docs/protocol.md:83-113`). |
| `EXECUTING` | Claude Code | `STATE: EXECUTING`<br>`TASK_ID: <id>`<br>`ITERATION: <n>` | Optional notification signalling local modifications/tests are actively running (`docs/protocol.md:31`). |
| `EXECUTED` | Claude Code | `STATE: EXECUTED`<br>`TASK_ID: <id>`<br>`ITERATION: <n>`<br>`RESULT:` ...<br>`CHANGED_FILES: <count>`<br>`TESTS: <summary>`<br>`RECORD_ID: <recId>` | Signals completion of local changes and test runs. Prompts ChatGPT to pull live diffs via `git_diff` and check `execution_output` (`docs/protocol.md:117-140`). |
| `REVIEW` | ChatGPT | Implicit / MCP tool invocations | ChatGPT independently calls MCP endpoints (`git_diff`, `read_file`, `execution_output`, `test_status`) to verify code quality against `SUCCESS_CRITERIA` (`docs/protocol.md:33`). |
| `DONE` | ChatGPT | `STATE: DONE`<br>`TASK_ID: <id>`<br>`ITERATION: <n>`<br>`SUMMARY:` ... | Verification complete; acceptance criteria satisfied across actual workspace diffs (`docs/protocol.md:149-156`). |
| `BLOCKED` | ChatGPT | `STATE: BLOCKED`<br>`TASK_ID: <id>`<br>`ITERATION: <n>`<br>`REASON:` ...<br>`NEEDS:` ... | Execution halted due to environmental failure, missing API keys, architectural conflicts, or required user decisions (`docs/protocol.md:160-169`). |
| `ERROR` | Either | `STATE: ERROR`<br>`TASK_ID: <id>`<br>`REASON:` ... | Unrecoverable protocol, transport, or infrastructure fault (`docs/protocol.md:36`). |
| `HANDOFF` | Claude Code | `STATE: HANDOFF`<br>`TASK_ID: <id>`<br>`ITERATION: <n>`<br>`ORIGINAL_GOAL:` ...<br>`PROGRESS:` ...<br>`CURRENT_STATE:` ...<br>`KNOWN_ISSUES:` ...<br>`NEXT_EXPECTED_STEP:` ... | Compact context brief dispatched when recovering from context compaction or switching ChatGPT conversations (`docs/protocol.md:176-198`). |

---

## 3. Compatibility with ChatGPT Web, Actions, and MCP Contracts

### 3.1 Streamable HTTP MCP Transport (`src/mcp/http.ts:1-45`)
- **Stateless MCP Server Instantiation (`src/mcp/http.ts:11-26`):** The handler constructs a fresh `McpServer` and `StreamableHTTPServerTransport` instance per incoming `POST` request (`sessionIdGenerator: undefined`, `enableJsonResponse: true`).
- **HTTP Method Compliance (`src/mcp/http.ts:13-21`):** `GET` and `DELETE` requests return `405 Method Not Allowed` with a valid JSON-RPC 2.0 error payload (`code: -32000`). This matches ChatGPT Actions connector expectations where sessionless request/response semantics are enforced.
- **Resource Teardown (`src/mcp/http.ts:27-30`):** `res.on("close")` guarantees graceful transport and server disconnection on client aborts or network dropouts.

### 3.2 OAuth 2.1 & RFC-Compliant Discovery Metadata
- **RFC 8414 Authorization Server Metadata (`src/auth/oauth.ts:42-56`):**
  - Exposed at `GET /.well-known/oauth-authorization-server` and `GET /.well-known/openid-configuration`.
  - Supports `code_challenge_methods_supported: ["S256"]`, `grant_types_supported: ["authorization_code", "refresh_token"]`, `token_endpoint_auth_methods_supported: ["none"]` (Public Client / PKCE).
- **Protected Resource Metadata (`src/auth/oauth.ts:58-66`):**
  - Exposed at `GET /.well-known/oauth-protected-resource/mcp`.
  - Informs ChatGPT of the exact resource URI, authorization servers, and required scopes (`workspace.read`, `workspace.search`, `git.read`, `execution.read`, `offline_access`).
- **Dynamic Client Registration (`src/auth/oauth.ts:182-198`):** Implements RFC 7591 dynamic registration (`POST /oauth/register`), generating persistent `c2c_client_<id>` client records with redirect URI validation.
- **PKCE Verification (`src/auth/oauth.ts:241-249`):** Strict verification of `code_verifier` against `code_challenge` using SHA-256 base64url encoding (`safeEqual(base64UrlSha256(verifier), authCode.codeChallenge)`).
- **Token Security & Rotation (`src/auth/store.ts:167-240`):**
  - Access tokens (`c2c_at_*`) with 1-hour TTL.
  - Refresh tokens (`c2c_rt_*`) with 30-day TTL.
  - Full refresh token rotation on `POST /oauth/token` (`grant_type: refresh_token`), invalidating the prior refresh token immediately upon consumption (`src/auth/store.ts:231-233`).

### 3.3 One-Time Local Pairing Code Security (`src/pairing/manager.ts:1-163`)
- **Entropy & Encoding:** 8-character CSPRNG code (`generateCode`) using a 30-character unambiguous charset (`[A-Z2-9]` excluding `I, L, O, 0, 1`).
- **Timing Defense:** Verification uses `crypto.timingSafeEqual` over SHA-256 digest buffers (`src/pairing/manager.ts:135`).
- **Brute-Force & Rate Limiting:**
  - Max 5 failed attempts per session (`maxAttempts: 5`).
  - IP-based rate limiting (10 attempts per minute).
  - 5-minute TTL (`ttlMs: 300,000`).
  - Single active session enforcement (`sessions.clear()` upon `create()`).

### 3.4 MCP Read-Only Tools Verification (`src/mcp/server.ts:58-326`)
All 9 registered MCP tools adhere to strict schemas and invariants:
1. `workspace_info` (`src/mcp/server.ts:58-90`): Returns workspace ID, root alias, project language/framework detection, and git commit/branch/dirty status.
2. `list_directory` (`src/mcp/server.ts:92-116`): Depth-bounded (1–4), paged directory traversal. Filters high-noise paths (`node_modules`, `.git`, build output) and ignore patterns.
3. `read_file` (`src/mcp/server.ts:118-142`): Line-paginated reader (default 400 lines, hard cap 2000 lines). Rejects sensitive files (`.env`, private keys) and binary files.
4. `search_workspace` (`src/mcp/server.ts:144-168`): Content search using ripgrep with Node.js fallback. Max 200 matches.
5. `git_status` (`src/mcp/server.ts:171-188`): Porcelain v2 structured git status.
6. `git_diff` (`src/mcp/server.ts:190-224`): Byte-offset paginated unified diff with strict sensitive file filtering and rename provenance leak prevention (`src/workspace/git.ts:211-238`).
7. `test_status` (`src/mcp/server.ts:227-255`): Read-only summary of latest execution record.
8. `execution_summary` (`src/mcp/server.ts:257-274`): History of recent task iterations.
9. `execution_output` (`src/mcp/server.ts:276-327`): Two-step command log viewer (`list` -> `read(id)`). Restricted outputs return `OUTPUT_RESTRICTED` with no body leakage.

---

## 4. Error Behavior and Disguised 404 Responses

### 4.1 Stealth Admin Surface Defense (`src/bridge/server.ts:140-152`)
```typescript
const adminGuard = (req: Request, res: Response, next: NextFunction): void => {
  const remote = req.socket.remoteAddress ?? "";
  const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const viaProxy = Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]);
  const header = req.headers.authorization ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!isLoopback || viaProxy || token !== adminToken) {
    res.status(404).end(); // Disguised 404: do not advertise admin endpoints to tunnel scanners
    return;
  }
  next();
};
```
- **Security Rationale:** Administrative endpoints (`/admin/pairing`, `/admin/info`, `/admin/tunnel/*`, `/admin/shutdown`, `/admin/revoke-all`) are exposed on the same HTTP server instance as `/mcp`.
- **Stealth Protection:** Rather than returning `401 Unauthorized` or `403 Forbidden` (which confirms the existence of administrative endpoints to external scanners probing the public Cloudflare tunnel), the bridge responds with `404 Not Found` for any request from a non-loopback IP, any request bearing proxy headers (`cf-connecting-ip`, `x-forwarded-for`), or any request lacking the local `adminToken`.

### 4.2 Workspace Security Error Hierarchy (`src/workspace/manager.ts:9-26, 122-172`)
- `INVALID_PATH`: Null bytes, Windows NTFS Alternate Data Streams (`::$DATA`, `:stream`), and trailing dot/space segments are rejected immediately (`src/workspace/manager.ts:135-151`).
- `PATH_OUTSIDE_WORKSPACE`: Canonical ancestor realpath validation detects and blocks directory traversal and symlink escapes (`src/workspace/manager.ts:155-164`).
- `ACCESS_DENIED_SENSITIVE_FILE`: Rejects access to sensitive file patterns (`.env*`, `id_rsa`, `*.pem`, `credentials.json`, `.npmrc`, etc.) without revealing file content (`src/workspace/manager.ts:165-170`).
- `BINARY_FILE`: Fails cleanly on binary files (detected via initial buffer null byte scanning) (`src/workspace/manager.ts:202-204`).

### 4.3 Fail-Closed MCP Error Translation (`src/mcp/server.ts:25-35`)
- MCP errors return `{ isError: true, content: [{ type: "text", text: JSON.stringify({ error: code, message }) }] }`.
- System crashes or unanticipated exceptions are wrapped as `INTERNAL_ERROR` without exposing raw call stacks or sensitive environment variables.

---

## 5. Execution Metadata & Checkpoint Lifecycle

### 5.1 Checkpoint Architecture (`src/session/state.ts:1-285`)
Session checkpoints maintain durable local state in `<stateDir>/sessions/<workspaceId>.json` (mode 0600) to ensure zero context loss across CLI interrupts, restarts, or chat resets.

```typescript
export interface TaskCheckpoint {
  taskId: string;
  iteration: number;
  protocolState: ProtocolState;
  waitingFor: WaitingFor;
  originalGoal?: string;
  completedSubtasks?: string;
  knownIssues?: string;
  nextExpectedStep?: string;
  chatUrl?: string;
  projectUrl?: string;
  updatedAt: string;
}
```

#### Local Checkpoint vs. Wire State Separation:
Internal local checkpoint states are distinct from wire states:
- `INIT`: Local initial state. Waiting for `GPT_PLAN`.
- `PLAN_RECEIVED`: Plan received in memory; local execution pending.
- `EXECUTING`: Local code editing / test execution in progress.
- `EXECUTED_LOCAL`: Local edits and tests completed, execution record committed (`c2c record`); `EXECUTED` wire message pending dispatch.
- `EXECUTED_SENT`: `EXECUTED` wire message sent; waiting for `GPT_REVIEW`.
- `DONE` / `BLOCKED`: Terminal states. Cleared via `c2c session set --clear-checkpoint` (`src/session/state.ts:204-206`).

#### Checkpoint Field Length Bounding (`src/session/state.ts:165-177`):
To prevent checkpoint serialization from expanding into bloated log repositories:
- `originalGoal`: max 500 chars
- `completedSubtasks`: max 800 chars
- `knownIssues`: max 800 chars
- `nextExpectedStep`: max 400 chars

### 5.2 Execution Records & Output Storage (`src/execution/records.ts`, `src/execution/output.ts`)
- **Execution Records (`src/execution/records.ts:10-22`):** Stored in append-only JSONL format (`<stateDir>/executions/<workspaceId>.jsonl`). Stores `taskId`, `iteration`, `changedFiles`, `tests` summary, `exitStatus`, `timestamp`, and `outputId`. Corrupted lines are skipped gracefully (`src/execution/records.ts:42-44`).
- **Command Output Redaction & Sanitization (`src/execution/sanitize.ts:1-75`):**
  1. **Hard Key Rejection (`src/execution/sanitize.ts:6-10`):** Rejects any output containing RSA, DSA, EC, OPENSSH, or PGP private keys (`allowed: false, reason: "private_key"`). The body is never written to disk (`src/execution/output.ts:80-89`).
  2. **Secret Redaction (`src/execution/sanitize.ts:12-22`):** Redacts GitHub tokens, OpenAI/Anthropic/Slack/AWS keys, passwords, and pairing codes.
  3. **Path Anonymization (`src/execution/sanitize.ts:28-33`):** Replaces user home directories (`/Users/foo`, `/home/bar`, `C:\Users\baz`) with `[user]`.
  4. **Size and Line Truncation (`src/execution/sanitize.ts:45-62`):** Clamped to max 200 lines and max 64 KB.
  5. **Rolling Storage Buffer (`src/execution/output.ts:92-97`):** Rolling capacity capped at `MAX_OUTPUT_RECORDS = 40`. Outdated log bodies are pruned from disk automatically.

---

## 6. Review Cycle Semantics

1. **Local Execution & Record Creation:**
   - Claude Code executes the steps detailed in `STATE: PLAN`.
   - After executing commands and running tests, Claude Code calls `c2c record` (`src/cli/index.ts:762-835`) to record the output, sanitize logs, and generate an execution record.
   - Checkpoint protocol state transitions from `EXECUTING` -> `EXECUTED_LOCAL`.
2. **Dispatching `EXECUTED`:**
   - Claude Code outputs the structured `[C2C] STATE: EXECUTED` prompt with `CHANGED_FILES`, `TESTS`, and `RECORD_ID`.
   - Checkpoint state transitions to `EXECUTED_SENT` (`waitingFor: GPT_REVIEW`).
3. **Independent ChatGPT Audit:**
   - ChatGPT invokes `git_diff` (`mode: unstaged` or `head`) over MCP to inspect exact code delta.
   - ChatGPT queries `execution_output` (`action: list`, followed by `action: read, id: <id>`) to check compiler/test output.
   - If `execution_output` status is `restricted`, ChatGPT relies on `git_diff` and `test_status`.
4. **Resolution Branching:**
   - **Criteria Met:** ChatGPT returns `[C2C] STATE: DONE`. Claude Code clears local checkpoint (`c2c session set --clear-checkpoint`).
   - **Further Iteration Required:** ChatGPT returns `[C2C] STATE: PLAN` (incrementing `ITERATION`). Claude Code updates checkpoint to `PLAN_RECEIVED` and iterates.
   - **Blocker Detected:** ChatGPT returns `[C2C] STATE: BLOCKED` with `REASON` and `NEEDS`. Claude Code prompts the human user for decision.

---

## 7. Invalid Messages, Malformed Payloads, and Stale State Handling

### 7.1 Malformed Control Messages & Parser Resilience
- **Missing Headers:** If a message arrives without `STATE:`, `TASK_ID:`, or `ITERATION:`, it is rejected by the executor harness or flagged for clarification.
- **Iteration Desynchronization:** If ChatGPT returns a `PLAN` with a stale or mismatched iteration number, the executor checks the session checkpoint (`readSession`) and requests a corrected plan or performs a `HANDOFF`.

### 7.2 Stale State & Chat Compaction Recovery (`HANDOFF`)
- When a ChatGPT conversation is compacted, exceeds context window limits, or crashes:
  1. Claude Code generates a `STATE: HANDOFF` brief (`docs/protocol.md:176-198`).
  2. The brief contains `ORIGINAL_GOAL`, `PROGRESS`, `CURRENT_STATE`, `KNOWN_ISSUES`, and `NEXT_EXPECTED_STEP`.
  3. ChatGPT parses the brief, calls `workspace_info` and `git_diff` via MCP to ground itself in the live filesystem state, and resumes from `NEXT_EXPECTED_STEP`.

### 7.3 Tunnel Reclaim & Dynamic Endpoint Repair (`src/config/endpoint.ts:48-55`, `src/cli/index.ts:470-628`)
- Cloudflare Quick Tunnels generate ephemeral URLs (`*.trycloudflare.com`). When a bridge restarts or the tunnel closes:
  - `connectorAction(previousMcpUrl, nextMcpUrl)` detects URL drift and classifies the required remediation (`none`, `create`, or `update`).
  - `c2c doctor --fix` automatically repairs the bridge, provisions a fresh tunnel, issues a new pairing code, and outputs a step-by-step update instruction for ChatGPT settings (`src/cli/index.ts:560-592`).

---

## 8. Retry, Deduplication, and Idempotency Semantics

| Component | Mechanism | Idempotency & Replay Guarantee |
| :--- | :--- | :--- |
| **MCP Tools** | Stateless queries (`src/mcp/server.ts:58-326`) | 100% idempotent. Pure read operations with zero disk or environment side effects. |
| **OAuth Authorization Codes** | `consumeAuthorizationCode` (`src/auth/store.ts:157-163`) | One-time consumption. Immediately deleted from memory/store upon exchange (`this.authCodes.delete(code)`). Replays return null (`400 Bad Request`). |
| **Pairing Codes** | `PairingManager.verify` (`src/pairing/manager.ts:135-140`) | One-time use. Deleted immediately upon successful verification (`this.sessions.delete(session.id)`). Max 5 attempts. |
| **OAuth Refresh Tokens** | `AuthStore.refresh` (`src/auth/store.ts:222-239`) | Strict refresh token rotation. Old refresh token is revoked and deleted prior to issuing a new token pair. |
| **Session Merging** | `mergeSession` (`src/session/state.ts:179-265`) | Deterministic functional state patching. Applying the same patch repeatedly produces identical stored state. |
| **Execution Logging** | `c2c record` (`src/execution/records.ts:29-32`) | Tagged by `taskId` and `iteration`. Historical records are preserved in append-only format; latest record is retrievable by workspace ID. |

---

## 9. Comprehensive File & Line Citation Index

| File Reference | Audited Scope & Responsibility |
| :--- | :--- |
| `docs/protocol.md:1-250` | Protocol architecture, wire state definitions (`INIT`, `PLAN`, `EXECUTING`, `EXECUTED`, `REVIEW`, `DONE`, `BLOCKED`, `ERROR`, `HANDOFF`), and message templates. |
| `.claude/skills/chatgpt-collab/SKILL.md:1-222` | Claude Code skill definition, dual-plane invariants, Mode C handoff workflow, prompt templates, and troubleshooting map. |
| `src/mcp/server.ts:58-326` | MCP Server tool registrations, schema validation, OAuth scope enforcement, untrusted instruction defense (`UNTRUSTED_NOTE`), and error mapping. |
| `src/mcp/http.ts:1-45` | Stateless Streamable HTTP transport implementation for remote MCP clients and ChatGPT Connectors. |
| `src/auth/oauth.ts:1-285` | RFC 8414 AS metadata, RFC 9207 protected resource metadata, RFC 7591 dynamic client registration, PKCE authorization code grant, and pairing UI. |
| `src/auth/store.ts:1-279` | Token and client persistence, access/refresh token generation, constant-time token comparison, and refresh token rotation. |
| `src/auth/middleware.ts:1-60` | Bearer token validation middleware for `/mcp` with `WWW-Authenticate` resource metadata challenge. |
| `src/pairing/manager.ts:1-163` | One-time CSPRNG pairing code generation, 5-minute TTL, rate limiting, and constant-time SHA-256 verification. |
| `src/session/state.ts:1-285` | Session persistence, conversation mode resolution (`long-chat` vs `project`), checkpoint lifecycle, and bounded checkpoint field limits. |
| `src/execution/records.ts:1-53` | Append-only execution record logging (`.jsonl`) and retrieval for `test_status` and `execution_summary`. |
| `src/execution/output.ts:1-120` | Command output indexing, storage, rolling buffer pruning (max 40 records), and retrieval. |
| `src/execution/sanitize.ts:1-75` | Output sanitization pipeline: private key hard rejection, API key/secret redaction, home directory path anonymization, and size capping. |
| `src/workspace/manager.ts:1-382` | Workspace path resolution, canonical realpath traversal defense, sensitive file access control, line-range file reader, and directory lister. |
| `src/workspace/git.ts:1-325` | Structured git status, bounded batch git diff generator, sensitive pattern filtering, and rename provenance tracking. |
| `src/workspace/search.ts:1-206` | Multi-engine workspace search (ripgrep with Node.js fallback) with result limits and truncation flags. |
| `src/bridge/server.ts:1-257` | HTTP bridge server lifecycle, loopback binding, health check, and disguised 404 admin surface guard. |
| `src/bridge/runtime.ts:1-111` | Runtime state tracking, bridge process probing, and PID liveness verification. |
| `src/config/endpoint.ts:1-81` | Endpoint persistence, public URL normalization, connector naming, and tunnel drift detection (`connectorAction`). |
| `src/cli/index.ts:1-840` | CLI command entry points (`start`, `setup`, `status`, `doctor`, `pair`, `unpair`, `session`, `record`, `tunnel`). |

---

## 10. Audit Conclusion

The C2C protocol implementation exhibits **exemplary architectural design, robust security boundaries, strict invariant enforcement, and full compatibility with ChatGPT Web, Custom Actions, and MCP contracts**.

1. **Dual-Plane Invariant Integrity:** The separation between the conversational control plane (< 1 KB) and the MCP data plane is complete and uncompromised.
2. **Security & Sandbox Isolation:** The 9 read-only MCP tools, paired with deepest-ancestor canonicalization, sensitive file denial, rename provenance tracking, and private key rejection gates, completely prevent unauthorized mutation and sensitive credential leakage.
3. **Resilience & State Recovery:** Checkpoint persistence, `HANDOFF` recovery briefs, and auto-repairing doctor routines provide robust fault tolerance against connection drops, token expirations, and chat compaction.

The protocol implementation is verified as **sound, secure, and production-ready**.
