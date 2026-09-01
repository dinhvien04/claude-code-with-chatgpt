# Comprehensive Verification & Test Strategy
# Project: Codex with ChatGPT (`codex-with-chatgpt` / `c2c`)
**Document Version:** 1.0.0  
**Target Version:** 0.1.1+  
**Date:** 2026-09-01  
**Status:** Approved Specification  

---

## 1. Executive Summary & Verification Philosophy

The `codex-with-chatgpt` (`c2c`) system bridges local developer workspaces with ChatGPT, establishing a clear separation of concerns:
- **ChatGPT thinks** (Reasoning, Planning, Review layer via MCP data plane and Computer Use control plane).
- **Codex works** (Harness execution, file editing, shell execution, testing, git operations).

Because the bridge opens a communication channel from a remote AI model into a local developer machine, **security, isolation, and read-only invariants are non-negotiable**. Any regression in workspace containment, sensitive file masking, scope enforcement, or token protection could lead to prompt injection exploits, remote data exfiltration, or secret leakage.

### Core Testing Invariants
1. **Absolute Read-Only Data Plane:** Under no circumstances shall write, execute, delete, commit, or package-installation tools exist in the MCP server.
2. **Strict Workspace Containment:** Canonical path resolution must prevent any access outside the designated workspace root across all operating systems (macOS, Linux, Windows), regardless of symlinks, traversal sequences, Unicode tricks, or path syntax.
3. **Defense-in-Depth Sensitive File Policy:** Files containing credentials, secrets, private keys, environment variables, or `.c2cignore` entries must never be returned in file reads, directory listings, searches, git diffs, or execution logs.
4. **Zero Trust in Remote/Model Input:** Workspace content is untrusted data; bearer tokens and pairing codes must be cryptographically protected, rate-limited, and never logged or leaked.
5. **Deterministic Control/Data Plane Separation:** Protocol control messages (`[C2C]`) must remain under 1 KB and never contain file bodies, git diffs, or execution logs.

---

## 2. Test Architecture & Coverage Matrix

```
┌────────────────────────────────────────────────────────────────────────┐
│                          End-to-End & CLI Tests                        │
│   c2c start | setup | doctor | session | prefs | record | tunnel       │
├────────────────────────────────────────────────────────────────────────┤
│                       Protocol & State Machine Tests                   │
│   INIT → PLAN → EXECUTED → REVIEW → HANDOFF | Checkpoint Persistence  │
├────────────────────────────────────────────────────────────────────────┤
│                     Integration & Transport Tests                      │
│   Stateless Streamable HTTP | OAuth 2.1 (PKCE S256) | MCP Protocols    │
├────────────────────────────────────────────────────────────────────────┤
│                         Security & Boundary Tests                      │
│   Path Traversal | Symlinks | Sensitive Exclusions | Diff Sanitization │
├────────────────────────────────────────────────────────────────────────┤
│                           Component Unit Tests                         │
│   Workspace | Search | Git | Pairing | AuthStore | Output Sanitizer    │
└────────────────────────────────────────────────────────────────────────┘
```

### Coverage Goals
- **Line Coverage:** $\ge 95\%$ across `src/**`
- **Branch Coverage:** $\ge 92\%$ across `src/**`
- **Security Invariant Paths:** $100\%$ branch coverage for `src/workspace/manager.ts`, `src/workspace/ignore.ts`, `src/workspace/git.ts`, `src/auth/`, `src/execution/sanitize.ts`, and `src/bridge/server.ts`.

---

## 3. Golden Tests (MUST NOT BE WEAKENED)

The following existing test suites enforce critical security boundaries and core functionality. They are designated as **Golden Invariants** and must never be removed, disabled, relaxed, or bypassed in future refactors:

| Test File | Test Suite / Spec Name | Critical Invariant Enforced |
|---|---|---|
| `tests/workspace.test.ts` | `rejects ../ traversal` | Rejects `../`, `../../etc/passwd`, and relative escapes via `WorkspaceError("PATH_OUTSIDE_WORKSPACE")`. |
| `tests/workspace.test.ts` | `rejects absolute paths outside the workspace` | Blocks `/etc/passwd` and foreign absolute paths. |
| `tests/workspace.test.ts` | `rejects windows-style traversal` | Blocks `..\..\etc\passwd` and backslash tricks. |
| `tests/workspace.test.ts` | `rejects null bytes` | Rejects null bytes `hello.txt\0.png` via `WorkspaceError("INVALID_PATH")`. |
| `tests/workspace.test.ts` | `rejects symlinked file escaping the workspace` | Symlink resolving outside workspace root fails closed. |
| `tests/workspace.test.ts` | `rejects paths through a symlinked directory escaping workspace` | Directory symlink escaping workspace fails closed. |
| `tests/workspace.test.ts` | `sensitive files` (all specs) | Enforces `ACCESS_DENIED_SENSITIVE_FILE` on `.env`, `.env.production`, `certs/server.pem`, `keys/id_rsa`, `nested/.ssh/config`, and `.c2cignore` rules; allows `.env.example`. |
| `tests/workspace.test.ts` | `denies binary files` | Binary files fail with `WorkspaceError("BINARY_FILE")`. |
| `tests/git.test.ts` | `excludes all IgnoreRules sensitive patterns across unstaged, staged, and head modes` | Blocks 9+ secret types from appearing in git diff outputs across all diff modes. |
| `tests/git.test.ts` | `handles rename provenance: sensitive->safe, safe->sensitive, safe->safe` | Two-layer provenance check ensures renaming a secret to a safe filename does not leak old secret contents. |
| `tests/git.test.ts` | `prevents cross-boundary scoped rename provenance leaks with path= scoping` | Scoped git diffs with `path="src"` do not leak root-level secret renames or deletions. |
| `tests/git.test.ts` | `gitDiff pagination` | Never splits lines mid-line, paginates cleanly on byte offsets with `hasMore` and `nextOffset`. |
| `tests/mcp-integration.test.ts` | `lists all nine read-only tools` | Asserts exact 9 read-only tools exist; explicitly asserts write/exec tools (`write_file`, `execute_shell`, `git_commit`, etc.) are absent. |
| `tests/mcp-integration.test.ts` | `enforces scopes per tool` | Tokens without required scopes receive `INSUFFICIENT_SCOPE` error. |
| `tests/mcp-integration.test.ts` | `git_diff over MCP blocks sensitive-to-safe renames` | MCP wire protocol preserves git rename provenance security. |
| `tests/oauth.test.ts` | `completes the full pairing + PKCE flow and calls MCP` | RFC 7591 DCR -> HTML Pairing -> PKCE S256 Code Exchange -> Bearer MCP request. |
| `tests/oauth.test.ts` | `rejects PKCE verifier mismatch` | Invalid code_verifier fails with `invalid_grant` (400). |
| `tests/oauth.test.ts` | `authorization codes are one-time` | Replay of authorization code fails with `400`. |
| `tests/oauth.test.ts` | `rotates refresh tokens and invalidates the old one` | Refresh token rotation ensures single-use; replay of previous refresh token fails. |
| `tests/oauth.test.ts` | `403 with a token bound to another workspace` | Workspace audience isolation: token from workspace A cannot access workspace B. |
| `tests/oauth.test.ts` | `sets browser security headers on the pairing page` | Enforces CSP (`default-src 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`. |
| `tests/pairing.test.ts` | `rejects wrong codes and limits attempts` | After max attempts (5 default / 3 in test), session is destroyed (`no_active_session`). |
| `tests/pairing.test.ts` | `rate limits per IP` | Enforces 10 req/min per IP rate limit. |
| `tests/pairing.test.ts` | `expires codes after the TTL` | Pairing code expires strictly after TTL (5 minutes). |
| `tests/port.test.ts` | `refuses to bind non-loopback hosts` | Attempting to bind `0.0.0.0` or external IP throws error. |
| `tests/runtime.test.ts` | `does not treat a live pid plus a failed probe as stopped` | Prevents starting a competing daemon when a live PID exists (`unknown` state). |
| `tests/execution-output.test.ts` | `rejects private keys entirely` | Output sanitizer refuses RSA, OpenSSH, PGP private keys with `allowed: false` (`private_key`). |
| `tests/sandbox-allow.test.ts` | `appends the table without rewriting existing Codex settings` | Safe AST/regex manipulation of `config.toml` preserving all user settings and comments. |

---

## 4. Test Suite Specifications by Domain

---

### Domain 1: Workspace Containment & File Security

#### Scope
`src/workspace/manager.ts`, `src/workspace/ignore.ts`, `src/workspace/search.ts`

#### Verification Goals
1. Verify `Workspace.resolve()` canonicalizes paths by `realpath` on the deepest existing ancestor, preventing traversal via symlinks or non-existent path suffixes.
2. Verify case-insensitivity on Windows and macOS (`c === r || c.startsWith(r + path.sep)`).
3. Verify comprehensive filtering against `SENSITIVE_PATTERNS` across all file operations (`readFile`, `listDirectory`, `searchWorkspace`).
4. Verify custom exclusion rules defined in `.c2cignore`.
5. Verify `readFile` pagination, binary file detection, and hard byte/line limits.

#### Concrete Test Cases

##### `TC-WS-001`: Deeply Nested Ancestor Canonicalization (Leaf Symlink Escape)
- **Target:** `Workspace.resolve()`
- **Prerequisites:** Workspace root `/tmp/test-ws` initialized.
- **Input:** Subdirectory `/tmp/test-ws/sym-dir` symlinked to outside directory `/tmp/outside`. Path requested: `sym-dir/sub1/sub2/file.txt` (where `sub1/sub2/file.txt` does not yet exist).
- **Execution:** Call `ws.resolve("sym-dir/sub1/sub2/file.txt")`.
- **Expected Output:** Throws `WorkspaceError` with `code: "PATH_OUTSIDE_WORKSPACE"`. Deepest existing ancestor (`sym-dir`) resolves outside `/tmp/test-ws`.

##### `TC-WS-002`: Windows Alternate Data Stream & Suffix Traversal Defense
- **Target:** `Workspace.resolve()`
- **Platform:** Windows (`win32`) & Cross-platform normalization.
- **Inputs:**
  1. `hello.txt::$DATA`
  2. `hello.txt...`
  3. `hello.txt ` (trailing space)
  4. `src/./../../etc/passwd`
  5. `workspace:/src/index.ts`
  6. `workspace:///../secrets.txt`
- **Expected Outputs:**
  1. Resolves safely to canonical `hello.txt` or throws `INVALID_PATH` / `PATH_OUTSIDE_WORKSPACE`.
  2. Resolves safely to canonical `hello.txt` without escaping.
  3. Normalizes correctly.
  4. Throws `WorkspaceError("PATH_OUTSIDE_WORKSPACE")`.
  5. Strips `workspace:/` prefix and resolves to `src/index.ts`.
  6. Strips prefix, identifies traversal escape, and throws `WorkspaceError("PATH_OUTSIDE_WORKSPACE")`.

##### `TC-WS-003`: Complete Sensitive File Pattern Matrix
- **Target:** `IgnoreRules.isSensitive()` & `Workspace.readFile()`
- **Inputs:** The following file paths placed in workspace:
  - Environment: `.env`, `.env.local`, `.env.production.local`, `.env.test`, `.env.stage`
  - Allowed Environment: `.env.example`, `.env.sample` (should be allowed)
  - Certificates & Keys: `cert.pem`, `priv.key`, `identity.p12`, `bundle.pfx`, `keystore.jks`, `app.keystore`
  - SSH Keys: `id_rsa`, `id_rsa.pub`, `id_ed25519`, `id_ed25519.backup`, `id_ecdsa`, `id_dsa`, `.ssh/config`, `nested/.ssh/known_hosts`
  - Cloud / Package Credentials: `.aws/credentials`, `.gnupg/secring.gpg`, `.npmrc`, `.netrc`, `_netrc`, `.git-credentials`, `credentials.json`, `service-account-prod.json`, `service-account.json`, `secrets.json`, `.cloudflared/cert.pem`, `.c2c-secrets.json`, `cookies.sqlite`, `Cookies`
- **Execution:** Call `ws.resolve(path)` for each.
- **Expected Output:**
  - `.env.example` and `.env.sample`: Successfully resolved (`ACCESS_DENIED_SENSITIVE_FILE` NOT thrown).
  - All other sensitive paths: Throws `WorkspaceError` with `code: "ACCESS_DENIED_SENSITIVE_FILE"`. Content never read.

##### `TC-WS-004`: `listDirectory` Depth, Noise Filtering, and Pagination
- **Target:** `Workspace.listDirectory()`
- **Setup:** Create workspace with:
  - `src/index.ts`, `src/utils/math.ts`, `src/utils/format.ts`
  - `node_modules/dep/index.js`, `.git/HEAD`, `dist/bundle.js`
  - `.env`, `.c2cignore` (`secret-folder/`), `secret-folder/data.json`
- **Input:**
  1. `listDirectory(".", { depth: 1, limit: 100 })`
  2. `listDirectory(".", { depth: 3, limit: 100 })`
  3. `listDirectory(".", { depth: 3, limit: 1, offset: 1 })`
- **Expected Outputs:**
  1. Returns `src/` (dir) and other root files; excludes `.git/`, `node_modules/`, `dist/`, `.env`, and `secret-folder/`.
  2. Recursively returns `src/utils/` and its children; total excludes all noise and sensitive patterns.
  3. Returns exactly 1 entry, `offset: 1`, `hasMore: true`, matching slice boundaries.

##### `TC-WS-005`: `readFile` Boundary Limits and Binary Handling
- **Target:** `Workspace.readFile()`
- **Inputs:**
  1. 3,000-line text file `huge.txt`
  2. 2 MB single-line text file `longline.txt`
  3. File with embedded null byte `\0` in first 8 KB `app.dat`
  4. Non-existent file `missing.ts`
- **Expected Outputs:**
  1. Unbounded read returns lines 1-400 (`startLine: 1, endLine: 400, totalLines: 3000, truncated: true, remainingLines: 2600, nextStartLine: 401`).
  2. Truncates at byte cap (`DEFAULT_MAX_BYTES = 256 KB`), `truncated: true`.
  3. Throws `WorkspaceError("BINARY_FILE")`.
  4. Throws `WorkspaceError("FILE_NOT_FOUND")`.

---

### Domain 2: Read-Only MCP Server & Tool Permissions

#### Scope
`src/mcp/server.ts`, `src/mcp/http.ts`, `src/bridge/server.ts`

#### Verification Goals
1. Strictly verify that **only the 9 approved read-only tools** are registered on the `McpServer`.
2. Verify that **no write, execution, or destructive tools** exist.
3. Verify that each tool enforces its exact required OAuth scope.
4. Verify stateless Streamable HTTP transport compliance: `GET` and `DELETE` return `405 Method Not Allowed`, while `POST` executes properly.
5. Verify JSON-RPC error mapping from `WorkspaceError` to standard tool error results (`isError: true`).

#### Concrete Test Cases

##### `TC-MCP-001`: Read-Only Tool Immutability & Registration Audit
- **Target:** `createMcpServer()`
- **Execution:** Connect an MCP Client over Streamable HTTP transport and execute `client.listTools()`.
- **Expected Output:**
  - Registered tool names strictly equal:
    `["execution_output", "execution_summary", "git_diff", "git_status", "list_directory", "read_file", "search_workspace", "test_status", "workspace_info"]`
  - Blacklist verification: The following names MUST NOT exist:
    `["write_file", "edit_file", "delete_file", "execute_shell", "run_command", "git_commit", "git_push", "install_package", "modify_config", "shell", "eval"]`.
  - All tools have `annotations: { readOnlyHint: true }`.
  - Server instructions contain `UNTRUSTED_NOTE`.

##### `TC-MCP-002`: Exhaustive Tool Scope Matrix
- **Target:** `server.registerTool` handlers in `src/mcp/server.ts`
- **Scope Matrix Table:**
  | Tool Name | Required Scope | Tested with Missing Scope | Tested with Valid Scope |
  |---|---|---|---|
  | `workspace_info` | `workspace.read` | Error `INSUFFICIENT_SCOPE` | Returns workspace metadata |
  | `list_directory` | `workspace.read` | Error `INSUFFICIENT_SCOPE` | Returns directory listing |
  | `read_file` | `workspace.read` | Error `INSUFFICIENT_SCOPE` | Returns file content |
  | `search_workspace` | `workspace.search` | Error `INSUFFICIENT_SCOPE` | Returns search results |
  | `git_status` | `git.read` | Error `INSUFFICIENT_SCOPE` | Returns git status |
  | `git_diff` | `git.read` | Error `INSUFFICIENT_SCOPE` | Returns git diff |
  | `test_status` | `execution.read` | Error `INSUFFICIENT_SCOPE` | Returns test status |
  | `execution_summary` | `execution.read` | Error `INSUFFICIENT_SCOPE` | Returns execution summary |
  | `execution_output` | `execution.read` | Error `INSUFFICIENT_SCOPE` | Returns output list/body |
- **Expected Result:** When caller token lacks required scope, MCP response returns `isError: true` with text containing `INSUFFICIENT_SCOPE` and the exact required scope string.

##### `TC-MCP-003`: Stateless HTTP Transport Endpoint Conformance
- **Target:** `createMcpHttpHandler()` at `/mcp`
- **Inputs:**
  1. `GET /mcp`
  2. `DELETE /mcp`
  3. `POST /mcp` without `Authorization` header
  4. `POST /mcp` with invalid JSON-RPC payload `{"jsonrpc": "1.0", "method": "invalid"}`
  5. `POST /mcp` with payload exceeding 8 MB limit
- **Expected Outputs:**
  1. HTTP `405 Method Not Allowed`, JSON error: `Method not allowed. Use POST.`
  2. HTTP `405 Method Not Allowed`.
  3. HTTP `401 Unauthorized` with header `WWW-Authenticate: Bearer realm="c2c", error="invalid_token", ...`.
  4. JSON-RPC error response or HTTP 400.
  5. HTTP `413 Payload Too Large`.

---

### Domain 3: OAuth 2.1 Server, Pairing & Token Security

#### Scope
`src/auth/oauth.ts`, `src/auth/store.ts`, `src/auth/middleware.ts`, `src/pairing/manager.ts`, `src/auth/html.ts`

#### Verification Goals
1. Verify RFC 8414 & Protected Resource Metadata discovery endpoints.
2. Verify Dynamic Client Registration (RFC 7591) rejects insecure/non-https redirect URIs (except loopback for development).
3. Verify PKCE `S256` is strictly enforced (plain PKCE rejected).
4. Verify pairing code lifecycle: CSPRNG generation without ambiguous characters (`ILO01`), one-time usage, 5-minute TTL, 5-attempt limit resulting in session invalidation, IP rate limiting.
5. Verify Token Management: stored as SHA-256 hashes, access token TTL (1 hour), refresh token TTL (30 days), single-use refresh token rotation, revocation (RFC 7009).
6. Verify Security Headers & XSS sanitization on the OAuth pairing HTML page.

#### Concrete Test Cases

##### `TC-AUTH-001`: OAuth Discovery Metadata Verification
- **Target:** `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`
- **Execution:** Send HTTP GET requests to discovery endpoints.
- **Expected Output:**
  - `oauth-authorization-server`:
    - `code_challenge_methods_supported`: strictly `["S256"]`
    - `grant_types_supported`: `["authorization_code", "refresh_token"]`
    - `token_endpoint_auth_methods_supported`: `["none"]`
    - `scopes_supported`: `["workspace.read", "workspace.search", "git.read", "execution.read", "offline_access"]`
  - `oauth-protected-resource/mcp`:
    - `resource`: matches `<baseUrl>/mcp`
    - `authorization_servers`: contains `<baseUrl>`

##### `TC-AUTH-002`: Dynamic Client Registration Validation (RFC 7591)
- **Target:** `POST /oauth/register`
- **Inputs:**
  1. `{ "client_name": "ChatGPT", "redirect_uris": ["https://chatgpt.com/callback"] }`
  2. `{ "client_name": "Local Test", "redirect_uris": ["http://127.0.0.1:19999/callback"] }`
  3. `{ "client_name": "Evil", "redirect_uris": ["http://evil.com/callback"] }` (Insecure HTTP remote)
  4. `{ "client_name": "Empty", "redirect_uris": [] }`
- **Expected Outputs:**
  1. HTTP `201 Created`, returns `client_id` starting with `c2c_client_`.
  2. HTTP `201 Created`.
  3. HTTP `400 Bad Request`, error: `invalid_redirect_uri`.
  4. HTTP `400 Bad Request`, error: `invalid_redirect_uri`.

##### `TC-AUTH-003`: PKCE S256 Enforcement & Security
- **Target:** `GET /oauth/authorize` & `POST /oauth/token`
- **Inputs:**
  1. Authorization request without `code_challenge` or with `code_challenge_method=plain`.
  2. Authorization request with valid `S256` challenge, followed by token exchange with wrong `code_verifier`.
  3. Authorization request with valid `S256` challenge, followed by token exchange with valid `code_verifier`.
- **Expected Outputs:**
  1. Redirects to `redirect_uri` with `error=invalid_request&error_description=PKCE+with+S256+is+required`.
  2. Token endpoint returns HTTP `400 Bad Request`, `error: "invalid_grant"`.
  3. Token endpoint returns HTTP `200 OK` with `access_token` (`c2c_at_...`) and `refresh_token` (`c2c_rt_...`).

##### `TC-AUTH-004`: Pairing Code Brute-Force & Rate-Limiting Defenses
- **Target:** `PairingManager` & `/oauth/authorize` POST
- **Inputs:**
  1. Create pairing session. Submit 5 invalid pairing codes (`"0000-0000"`, `"1111-1111"`, etc.).
  2. Submit 6th attempt with the valid code.
  3. Create pairing session. Submit 11 rapid invalid attempts from same IP within 1 minute.
- **Expected Outputs:**
  1. Attempts 1-4 return `401` with remaining attempt count; attempt 5 returns `410` (`too_many_attempts`), destroying the pairing session.
  2. 6th attempt fails with `no_active_session`.
  3. Returns `rate_limited` on 11th request.

##### `TC-AUTH-005`: Refresh Token Rotation & Replay Attack Defense
- **Target:** `AuthStore.refresh()` & `POST /oauth/token`
- **Execution:**
  1. Issue token pair ($AT_1$, $RT_1$).
  2. Use $RT_1$ to refresh -> receive ($AT_2$, $RT_2$). Verify $RT_2 \ne RT_1$.
  3. Attempt to use $RT_1$ again (Replay attack).
  4. Use $RT_2$ with incorrect `client_id`.
- **Expected Outputs:**
  1. Refresh succeeds ($200\text{ OK}$).
  2. $RT_1$ is revoked; refresh returns HTTP `400 Bad Request` (`invalid_grant`).
  3. Returns HTTP `400 Bad Request` (`invalid_client`).

##### `TC-AUTH-006`: HTML Pairing Page XSS & Security Headers
- **Target:** `GET /oauth/authorize`
- **Setup:** Workspace named `<script>alert('xss')</script>" autofocus onfocus="alert(1)`
- **Execution:** Fetch pairing page HTML.
- **Expected Output:**
  - Content has `&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;&quot;`. No raw `<script>` or attribute injections.
  - Headers present:
    - `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; base-uri 'none'; frame-ancestors 'none'`
    - `X-Content-Type-Options: nosniff`
    - `X-Frame-Options: DENY`
    - `Referrer-Policy: no-referrer`
    - `Cache-Control: no-store, max-age=0`

---

### Domain 4: C2C Agent Protocol & State Machine

#### Scope
`docs/protocol.md`, `src/session/state.ts`, `src/cli/index.ts` (session commands)

#### Verification Goals
1. Verify protocol state model: `INIT`, `PLAN`, `EXECUTING`, `EXECUTED`, `REVIEW`, `DONE`, `BLOCKED`, `ERROR`, `HANDOFF`.
2. Verify strict control plane vs data plane message sizing ($< 1\text{ KB}$), ensuring no logs or diffs are pasted into messages.
3. Verify local session checkpoint states (`INIT`, `PLAN_RECEIVED`, `EXECUTING`, `EXECUTED_LOCAL`, `EXECUTED_SENT`, `DONE`, `BLOCKED`) and ensure resume does not corrupt session state.
4. Verify `HANDOFF` brief construction and capping: `ORIGINAL_GOAL`, `PROGRESS`, `CURRENT_STATE`, `KNOWN_ISSUES`, `NEXT_EXPECTED_STEP`.
5. Verify checkpoint text length caps (500 chars with ellipsis).

#### Concrete Test Cases

##### `TC-PROT-001`: Control Message Formatting & Size Verification
- **Target:** Protocol control message generator
- **Inputs:**
  1. `INIT` message with standard goal and instructions.
  2. `EXECUTED` message with 4 changed files, 27 passed tests.
  3. `HANDOFF` continuation brief with 4 subtask bullet points.
- **Expected Outputs:**
  - Starts with `[C2C]`.
  - Contains valid `STATE:`, `TASK_ID:`, `ITERATION:` headers.
  - Byte length is strictly $< 1024$ bytes.
  - Contains no raw file diffs, code listings, or terminal dump blocks.

##### `TC-PROT-002`: Session Checkpoint State Transitions & Length Capping
- **Target:** `mergeSession()` & `src/session/state.ts`
- **Inputs:**
  1. Save checkpoint with `originalGoal` of 600 characters.
  2. Advance checkpoint through `INIT` -> `PLAN_RECEIVED` -> `EXECUTING` -> `EXECUTED_LOCAL` -> `EXECUTED_SENT`.
  3. Clear checkpoint via `--clear-checkpoint` flag on task completion.
- **Expected Outputs:**
  1. `checkpoint.originalGoal` is truncated to $\le 501$ characters ending with `…`.
  2. All intermediate states persist without losing `projectUrl`, `connectorName`, or `url`.
  3. `checkpoint` is set to `undefined`, while `url` and `projectUrl` remain intact.

##### `TC-PROT-003`: Long-Chat vs Project Conversation Resolution
- **Target:** `resolveConversation()`
- **Inputs:**
  1. Session data is `null`.
  2. Session data has `url` but no `projectUrl` or `conversationMode` (legacy session).
  3. Session data has `conversationMode: "project"`, `projectUrl: "https://chatgpt.com/g/g-p-12345/project"`.
  4. Session data has `conversationMode: "long-chat"`, `projectUrl: "https://chatgpt.com/g/g-p-12345/project"`.
- **Expected Outputs:**
  1. `mode: "project"`, `reason: "new-workspace"`, `reuseSavedChat: false`.
  2. `mode: "long-chat"`, `reason: "existing-long-chat"`, `reuseSavedChat: true`.
  3. `mode: "project"`, `projectReady: true`, `reuseSavedChat: false`.
  4. `mode: "long-chat"`, `reuseSavedChat: true` (explicit user opt-out overrides Project URL).

---

### Domain 5: Execution Records & Output Sanitization

#### Scope
`src/execution/records.ts`, `src/execution/output.ts`, `src/execution/sanitize.ts`

#### Verification Goals
1. Verify JSONL execution record appending and retrieval (`latestExecutionRecord`, `readExecutionRecords`).
2. Verify Output Sanitizer hard rejections: Private keys (RSA, EC, DSA, OpenSSH, PGP) must return `allowed: false` (`private_key`).
3. Verify Output Sanitizer extra redactions: Bearer tokens, GitHub tokens (`ghp_`, `github_pat_`), OpenAI keys (`sk-`), Slack tokens (`xox-`), AWS keys (`AKIA`), Google API keys (`AIza`), user home directories (`/Users/[user]`, `C:\Users\[user]`).
4. Verify Output Sanitizer size/line caps: Max 200 lines, Max 64 KB, with `…[truncated]` marker.
5. Verify Execution Output Store index maintenance, 40-record FIFO pruning, and disk body cleanup.

#### Concrete Test Cases

##### `TC-EXEC-001`: Private Key Hard-Reject Sanitization
- **Target:** `sanitizeExecutionOutput()`
- **Inputs:**
  1. `"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"`
  2. `"-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbg...\n-----END OPENSSH PRIVATE KEY-----"`
  3. `"-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion...\n-----END PGP PRIVATE KEY BLOCK-----"`
  4. `"-----BEGIN EC PRIVATE KEY-----\nMHQC...\n-----END EC PRIVATE KEY-----"`
  5. `"-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF...\n-----END ENCRYPTED PRIVATE KEY-----"`
- **Expected Output:** For all inputs, `allowed: false`, `reason: "private_key"`. No sanitized text generated.

##### `TC-EXEC-002`: Token & Home Path Redaction in Command Output
- **Target:** `sanitizeExecutionOutput()`
- **Input:**
  ```
  Ran test on /Users/johndoe/project/test.js with flags:
  --token=c2c_at_1234567890abcdef1234567890abcdef
  --github-pat=github_pat_11AAAAAA00000000000000_1234567890
  --openai-key=sk-1234567890abcdef1234567890abcdef
  --aws-key=AKIAIOSFODNN7EXAMPLE
  --pairing=ABCD-EFGH
  Wrote log to C:\Users\johndoe\AppData\Local\log.txt
  ```
- **Expected Output:**
  - `allowed: true`
  - `/Users/johndoe` -> `/Users/[user]`
  - `C:\Users\johndoe` -> `C:\Users\[user]`
  - All token values replaced with `[REDACTED]`
  - `ABCD-EFGH` pairing code redacted.

##### `TC-EXEC-003`: Output Store FIFO Pruning & Body Cleanup
- **Target:** `saveExecutionOutput()`, `listExecutionOutputs()`, `readExecutionOutput()`
- **Setup:** Isolate state dir.
- **Execution:**
  1. Save 45 execution outputs sequentially (`id` 1 through 45).
  2. Verify `listExecutionOutputs()` returns last 20 items (ids 26 to 45).
  3. Check existence of body files on disk for items 1-5 vs items 6-45.
- **Expected Output:**
  - Total items in index does not exceed `MAX_OUTPUT_RECORDS` (40).
  - Body files for pruned items (`1.txt` through `5.txt`) are deleted from disk via `fs.rmSync`.
  - Body files for remaining items exist with `0600` permissions.

---

### Domain 6: Bridge Runtime, Daemon Lifecycle & Port Management

#### Scope
`src/bridge/server.ts`, `src/bridge/runtime.ts`, `src/process/daemon.ts`

#### Verification Goals
1. Verify bridge strictly binds to loopback (`127.0.0.1`, `::1`, `localhost`) and rejects `0.0.0.0` or public interfaces.
2. Verify port collision handling: if preferred port (48765) is taken by another app, fall back to ephemeral port.
3. Verify `/health` endpoint returns minimal payload (`service`, `version`, `workspaceId`, `status: "ok"`) without exposing sensitive internals.
4. Verify Admin API guard: requires loopback origin, rejects requests containing proxy headers (`x-forwarded-for`, `cf-connecting-ip`), requires valid `adminToken`, and returns `404` on authentication failure to disguise the endpoint.
5. Verify daemon observation logic: `healthy`, `stopped` (`runtime_missing`, `pid_missing`), and `unknown` (`probe_failed`, `workspace_mismatch`).

#### Concrete Test Cases

##### `TC-BRG-001`: Loopback Host Enforcement
- **Target:** `startBridge()`
- **Inputs:**
  1. `host: "127.0.0.1"`
  2. `host: "localhost"`
  3. `host: "::1"`
  4. `host: "0.0.0.0"`
  5. `host: "192.168.1.50"`
- **Expected Outputs:**
  - 1, 2, 3: Bridge starts successfully.
  - 4, 5: Throws Error: `"The bridge only binds to loopback addresses. Public exposure goes through the tunnel."`

##### `TC-BRG-002`: Port Fallback & Health Identification
- **Target:** `startBridge()` & `probeBridge()`
- **Execution:**
  1. Start Bridge A on preferred port $P$.
  2. Start Bridge B for a different workspace requesting preferred port $P$.
  3. Probe port $P$ and Bridge B's assigned port.
- **Expected Outputs:**
  - Bridge A port is $P$.
  - Bridge B falls back to an ephemeral port $> 0$ ($P_B \ne P$).
  - `probeBridge(P)` identifies Workspace A's `workspaceId`.
  - `probeBridge(P_B)` identifies Workspace B's `workspaceId`.

##### `TC-BRG-003`: Admin API Guard & Proxy Header Defense
- **Target:** `/admin/*` routes in `src/bridge/server.ts`
- **Inputs:**
  1. `POST /admin/pairing` without `Authorization` header.
  2. `POST /admin/pairing` with invalid bearer token `Bearer wrong_token`.
  3. `POST /admin/pairing` with valid `adminToken` but including header `X-Forwarded-For: 203.0.113.195`.
  4. `POST /admin/pairing` with valid `adminToken` but including header `CF-Connecting-IP: 203.0.113.195`.
  5. `POST /admin/pairing` with valid `adminToken` from loopback without proxy headers.
- **Expected Outputs:**
  - 1, 2, 3, 4: Returns HTTP `404 Not Found` (endpoint disguised).
  - 5: Returns HTTP `200 OK` with `{ code, expiresAt }`.

---

### Domain 7: Cloudflare Tunnels (Quick & Named Tunnels)

#### Scope
`src/tunnel/cloudflared.ts`, `src/tunnel/cloudflared-named.ts`, `src/tunnel/detect.ts`, `src/tunnel/hostname.ts`, `src/tunnel/named-provision.ts`, `src/tunnel/state.ts`

#### Verification Goals
1. Verify Quick Tunnel URL parsing from `cloudflared` stdout/stderr banners, rejecting non-trycloudflare or fake hosts.
2. Verify Quick Tunnel start timeout and health verification before resolving public URL.
3. Verify Named Tunnel hostname formatting (`c2c-<project>.<zone>`) and fallback handling for non-ASCII project names (`c2c-ws-<id>`).
4. Verify Named Tunnel provisioning lifecycle, login prompts, and fallback to Quick Tunnel when provisioning fails.
5. Verify Tunnel state persistence in user state dir (`tunnels/<workspaceId>.json`), never inside the project.

#### Concrete Test Cases

##### `TC-TUN-001`: Quick Tunnel Banner Parsing & Validation
- **Target:** `parseQuickTunnelUrl()`
- **Inputs:**
  1. `"2026-08-28 INF | https://random-words-1234.trycloudflare.com |"`
  2. `"INF https://api.trycloudflare.com"`
  3. `"INF https://evil.com/trycloudflare.com"`
  4. `"INF https://random.trycloudflare.com.attacker.com"`
- **Expected Outputs:**
  1. Returns `"https://random-words-1234.trycloudflare.com"`.
  2. Returns `null` (Cloudflare internal API host ignored).
  3. Returns `null`.
  4. Returns `null`.

##### `TC-TUN-002`: Named Hostname Normalization & Generation
- **Target:** `suggestedNamedHostname()`, `hostnameSlug()`, `normalizeNamedTunnelHostname()`
- **Inputs:**
  1. Zone: `"Example.COM"`, Name: `"My Web App"`, ID: `"abc123def456"`
  2. Zone: `"domain.io"`, Name: `"回声项目"`, ID: `"9876543210ab"` (Non-ASCII name)
  3. Input hostname: `"Dev.MyDomain.Com."`
  4. Input hostname: `"https://invalid.com"` or `"localhost"`
- **Expected Outputs:**
  1. `"c2c-my-web-app.example.com"`
  2. `"c2c-ws-98765432.domain.io"` (Falls back to ASCII workspace slug)
  3. Normalized to `"dev.mydomain.com"`
  4. Throws invalid hostname error.

##### `TC-TUN-003`: Named Tunnel Provisioning Fallback Mechanism
- **Target:** `provisionNamedTunnel()`
- **Setup:** Mock `CloudflaredAccount` where `createTunnel` throws `Error("Authentication failed / No zone")`.
- **Input:** `workspaceId: "ws_fail", zone: "example.com"`
- **Expected Output:**
  - `result.fallback === true`
  - `result.state.preference === "quick"`
  - `result.userMessage` contains notice of temporary address fallback.
  - Persisted tunnel state records fallback reason.

---

### Domain 8: Claude Code / Codex Configuration & Multi-Platform Paths

#### Scope
`src/config/paths.ts`, `src/config/sandbox-allow.ts`, `src/config/ui-prefs.ts`, `src/config/endpoint.ts`

#### Verification Goals
1. Verify OS state directory resolution:
   - macOS (`darwin`): `~/Library/Application Support/codex-with-chatgpt`
   - Windows (`win32`): `%LOCALAPPDATA%/codex-with-chatgpt`
   - Linux: `$XDG_STATE_HOME/codex-with-chatgpt` or `~/.local/state/codex-with-chatgpt`
   - Test override: `C2C_STATE_DIR`
2. Verify strict directory (`0700`) and file (`0600`) permission modes.
3. Verify Codex `config.toml` sandbox allowlist upsert (`[sandbox_workspace_write] writable_roots = [...]`):
   - Path normalization across Windows (`C:\...` -> `C:/...`) and Unix.
   - Non-destructive AST update: preserves comments, other tables, and formatting.
   - Full idempotency across repeated runs.
4. Verify Connector name generation and reclaim logic.

#### Concrete Test Cases

##### `TC-CFG-001`: OS-Specific State Directory Resolution
- **Target:** `getStateDir()`
- **Inputs & Mocked Platforms:**
  1. `process.env.C2C_STATE_DIR = "/custom/state"`
  2. Platform `darwin`, Home `/Users/ada`
  3. Platform `win32`, `LOCALAPPDATA = "C:\\Users\\ada\\AppData\\Local"`
  4. Platform `linux`, `XDG_STATE_HOME = "/home/ada/.state"`
  5. Platform `linux`, unset `XDG_STATE_HOME`, Home `/home/ada`
- **Expected Outputs:**
  1. `/custom/state`
  2. `/Users/ada/Library/Application Support/codex-with-chatgpt`
  3. `C:\Users\ada\AppData\Local\codex-with-chatgpt`
  4. `/home/ada/.state/codex-with-chatgpt`
  5. `/home/ada/.local/state/codex-with-chatgpt`

##### `TC-CFG-002`: Complex TOML Sandbox Allowlist Upsert & Preservation
- **Target:** `upsertWritableRoot()` & `ensureSandboxAllowlist()`
- **Input Content:**
  ```toml
  # User configuration
  model = "gpt-5.6"

  [features]
  experimental_mode = true

  [projects."/Users/ada/my-project"]
  trust_level = "trusted"
  ```
- **State Dir to Add:** `/Users/ada/Library/Application Support/codex-with-chatgpt`
- **Expected Output:**
  - Content retains comments `# User configuration`.
  - `model = "gpt-5.6"`, `[features]`, and `[projects."/Users/ada/my-project"]` remain completely intact.
  - Adds:
    ```toml
    [sandbox_workspace_write]
    writable_roots = ["/Users/ada/Library/Application Support/codex-with-chatgpt"]
    ```
  - Running a second time with `C:\Users\Ada\...` or different slash casing results in zero changes (fully idempotent).

##### `TC-CFG-003`: Endpoint Reclaim & Connector Action Logic
- **Target:** `connectorAction()`, `connectorNameFor()`
- **Inputs:**
  1. Previous MCP URL `null`, Next MCP URL `"https://a.trycloudflare.com/mcp"`
  2. Previous MCP URL `"https://a.trycloudflare.com/mcp"`, Next MCP URL `"https://a.trycloudflare.com/mcp/"`
  3. Previous MCP URL `"https://old.trycloudflare.com/mcp"`, Next MCP URL `"https://new.trycloudflare.com/mcp"`
  4. Workspace Name `"EchoMind"`, `hadEndpointBefore: true`, `previousName: "Codex with ChatGPT"`
  5. Workspace Name `"Landing Page"`, `hadEndpointBefore: false`
- **Expected Outputs:**
  1. Action `"create"`
  2. Action `"none"` (normalized match)
  3. Action `"update"` (URL changed, prompt user to delete and re-add)
  4. Returns `"Codex with ChatGPT"` (retains legacy/custom title)
  5. Returns `"Codex with ChatGPT · Landing Page"`

---

### Domain 9: Backward Compatibility & Migration

#### Scope
`src/session/state.ts`, `src/config/endpoint.ts`, `src/execution/records.ts`

#### Verification Goals
1. Verify legacy session files (prior to Project / Checkpoint support) load without error and do not force migration.
2. Verify legacy endpoint files without custom names fall back seamlessly to `"Codex with ChatGPT"`.
3. Verify execution records without `outputId` or `outputAvailable` continue to parse and return expected schema in `execution_summary` and `test_status`.

#### Concrete Test Cases

##### `TC-BC-001`: Legacy Session File Compatibility
- **Target:** `readSession()`, `resolveConversation()`, `mergeSession()`
- **Input File Content:**
  ```json
  {
    "url": "https://chatgpt.com/c/legacy-conversation-id",
    "taskId": "c2c_old1",
    "iteration": 3,
    "lastState": "EXECUTED",
    "savedAt": "2025-12-01T00:00:00.000Z"
  }
  ```
- **Expected Outputs:**
  - `resolveConversation()` returns `mode: "long-chat"`, `reason: "existing-long-chat"`, `reuseSavedChat: true`.
  - Checkpoint is `undefined`.
  - Next update writes checkpoint without erasing legacy chat URL.

##### `TC-BC-002`: Legacy Execution Record Format
- **Target:** `readExecutionRecords()` & `latestExecutionRecord()`
- **Input JSONL:**
  ```json
  {"taskId":"c2c_v0","iteration":1,"changedFiles":["src/a.ts"],"tests":"10 passed","exitStatus":"ok","timestamp":"2025-11-01T00:00:00.000Z"}
  ```
- **Expected Output:**
  - Parses successfully.
  - `outputAvailable` defaults to `false`, `outputId` is `undefined`.
  - `test_status` MCP tool returns `outputAvailable: false, outputId: null`.

---

### Domain 10: Startup Smoke Tests & CLI Automation

#### Scope
`bin/c2c.js`, `src/cli/index.ts`

#### Verification Goals
1. Verify all CLI commands execute with `--json` and return valid JSON structures conforming to schema.
2. Verify CLI error handling outputs `{ "ok": false, "error": "..." }` and exits with code 1.
3. Verify `c2c doctor --no-fix --json` performs non-destructive diagnostics.
4. Verify `c2c setup --no-tunnel --json` runs locally without requiring `cloudflared`.
5. Verify `c2c session get/set/clear` CLI workflows.

#### Concrete Test Cases

##### `TC-CLI-001`: CLI JSON Output & Exit Code Conformance
- **Target:** `src/cli/index.ts` via subprocess invocation
- **Command Matrix:**
  | Command | Options | Expected JSON Fields | Expected Exit Code |
  |---|---|---|---|
  | `c2c status` | `--json` | `ok`, `running`, `workspaceId` (or `running: false`) | 0 |
  | `c2c workspace` | `--json` | `workspaceId`, `name`, `root`, `projectType` | 0 |
  | `c2c prefs get` | `--json` | `ok`, `developerModeEnabled`, `setupMode` | 0 |
  | `c2c prefs set` | `--developer-mode --json` | `ok`, `developerModeEnabled: true` | 0 |
  | `c2c session get` | `--json` | `ok`, `conversation`, `session` | 0 |
  | `c2c session set` | `--mode invalid --json` | `ok: false`, `error` | 1 |
  | `c2c tunnel status` | `--json` | `ok`, `needsChoice`, `preference` | 0 |
  | `c2c doctor` | `--no-fix --json` | `report`, `repairs`, `chatgptRepair` | 0 or 1 |
  | `c2c record` | missing `--task` | Commander argument error | 1 |

##### `TC-CLI-002`: Local Setup & Pairing Generation Workflow
- **Target:** `c2c setup --no-tunnel --json` -> `c2c pair --json` -> `c2c unpair`
- **Execution:**
  1. Run `c2c setup --no-tunnel --json` in a test workspace.
  2. Parse output for `pairingCode` and local `mcpUrl`.
  3. Run `c2c pair --json` -> verify fresh pairing code generated.
  4. Run `c2c unpair` -> verify token revocation and cleanup.
- **Expected Output:**
  - Setup completes with `local: true`, `sandbox.ok: true`.
  - Bridge starts on 127.0.0.1.
  - Pairing codes match regex `^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$`.
  - Unpair completes with exit code 0.

---

## 5. Test Infrastructure & Tooling Roadmap

### 1. Environment Isolation
All temporary test workspaces must be created inside `.tooling/test-tmp/` via `makeTmpDir()` to ensure tests run reliably in restricted container environments where global `/tmp` or `C:\Temp` may be non-writable.

### 2. State Directory Isolation
Every test modifying state must invoke `isolateStateDir()` in `beforeEach` / `beforeAll` and restore `process.env.C2C_STATE_DIR` during cleanup.

### 3. Git Ceiling Isolation
When testing non-git workspace scenarios, set `process.env.GIT_CEILING_DIRECTORIES = path.dirname(plainWorkspace)` to prevent git from traversing up into the repository root.

### 4. Continuous Integration Pipeline (CI)
- **Node.js Matrix:** Node.js v20.x, v22.x, v24.x
- **OS Matrix:** `ubuntu-latest`, `macos-latest`, `windows-latest`
- **Command Sequence:**
  ```bash
  pnpm typecheck
  pnpm test --coverage
  ```
- **Gate:** Zero test failures, zero skipped security tests (except symlink tests on unprivileged Windows runners where privileges cannot be acquired), $\ge 95\%$ coverage.

---

## 6. Verification Checklist & Sign-Off

- [x] All 9 read-only MCP tools tested with scope verification
- [x] Zero write/execute tools verified
- [x] Workspace boundary & canonical path containment tested across OS platforms
- [x] Symlink file and directory escapes tested
- [x] Comprehensive sensitive file patterns tested (.env, keys, ssh, aws, npmrc, etc.)
- [x] Rename provenance tracking tested in git diffs
- [x] OAuth 2.1 authorization-code flow with PKCE S256 tested
- [x] Dynamic Client Registration and security header injection tested
- [x] Pairing code rate-limiting, TTL, and brute-force destruction tested
- [x] Token hashing, rotation, and revocation tested
- [x] Execution output sanitizer (private keys, secret redaction, home path redaction) tested
- [x] C2C Protocol states, handoff, and checkpointing tested
- [x] Multi-platform configuration & TOML preservation tested
- [x] CLI commands and error handling tested
- [x] Golden tests explicitly cataloged and protected against weakening
