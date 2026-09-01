# Security Post-Implementation Audit Report (Post-Implementation Review)

**Target Project:** `codex-with-chatgpt` (`c2c-bridge`)  
**Audit Date:** 2026-09-01  
**Assessor:** `security-reviewer` (Independent Read-Only Post-Implementation Audit)  
**Output Document:** `SECURITY_AUDIT_POST.md`  

---

## 1. Executive Summary

This independent post-implementation security review evaluated the complete codebase of `codex-with-chatgpt` (`c2c-bridge`). The system establishes a bridge connecting **ChatGPT Web** (acting as the conversational and planning brain) to **Claude Code / Codex** (acting as the local execution harness) over an authenticated Model Context Protocol (MCP) Streamable HTTP transport and Cloudflare Tunnel.

### Core Security Invariants Validation

| Security Invariant | Requirement | Status | Verification Evidence |
| :--- | :--- | :---: | :--- |
| **Strict Read-Only MCP Surface** | ChatGPT must NEVER receive shell execution, write, delete, process spawn, or mutating git tools. | **VERIFIED CLEAN** | `src/mcp/server.ts:58-328` registers exactly 9 read-only inspection tools. Zero write/delete/exec/mutate tools exist in the server. |
| **Workspace Boundary & Path Traversal** | Access must strictly resolve within the canonical workspace root. Traversal, symlink escapes, NTFS ADS streams, and trailing-dot normalizations must be blocked. | **VERIFIED CLEAN** | `src/workspace/manager.ts:102-172` enforces deepest-ancestor canonical realpath resolution, NTFS colon/ADS rejection, and trailing dot/space segment rejection. |
| **Sensitive File & Secret Shielding** | Files containing credentials (`.env*`, `.git/**`, SSH keys, certificates, tokens, cloud configs) must be inaccessible via MCP tools (`read_file`, `search_workspace`, `git_diff`, `list_directory`). | **VERIFIED CLEAN** | `src/workspace/ignore.ts:12-58, 89-126` enforces comprehensive deny-by-default filtering with case-insensitive normalization on Windows and macOS. |
| **OAuth 2.1 & Ephemeral Pairing** | Authentication must require strict OAuth 2.1 with PKCE S256, CSPRNG one-time pairing codes, and workspace-bound tokens. | **VERIFIED CLEAN** | `src/auth/oauth.ts`, `src/auth/store.ts`, `src/pairing/manager.ts` enforce PKCE S256, one-time pairing codes (~40 bits entropy, 5-min TTL, 5-attempt lockout), SHA-256 token hashing at rest, and workspace binding. |
| **Log & Execution Output Sanitization** | Command outputs shared with ChatGPT must be scrubbed of private keys, modern API tokens, credentials, and user home paths. | **VERIFIED CLEAN** | `src/execution/sanitize.ts:6-74` hard-rejects private key blocks and redacts OpenAI (`sk-proj-`), Anthropic (`sk-ant-`), GitHub, Google, Slack, AWS tokens, bearer credentials, and filesystem user paths. |
| **Loopback & Proxy Isolation** | Admin routes must not be accessible via tunnels or spoofed headers. | **VERIFIED CLEAN** | `src/bridge/server.ts:98, 140-152` sets `trust proxy` to `loopback` and rejects any request containing proxy headers (`cf-connecting-ip`, `x-forwarded-for`) or lacking the loopback-only admin token. |

---

## 2. Comprehensive Findings & Rating Matrix

All findings are classified according to severity (CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL):

| Finding ID | Severity | Status | Category | Title | File & Line Reference |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **SEC-POST-01** | **VERIFIED FIXED** | Clean | Path Traversal / Win32 | NTFS Alternate Data Streams (`::$DATA`, `:stream`) Protection | `src/workspace/manager.ts:134-141` |
| **SEC-POST-02** | **VERIFIED FIXED** | Clean | Path Traversal / Win32 | Trailing Dot and Whitespace Path Segment Normalization | `src/workspace/manager.ts:143-151` |
| **SEC-POST-03** | **VERIFIED FIXED** | Clean | Information Disclosure | Case-Insensitive Secret Blacklist Matching on Windows & macOS | `src/workspace/ignore.ts:5-6, 95-96, 110-126` |
| **SEC-POST-04** | **VERIFIED FIXED** | Clean | Secret Leakage | `.git/` Directory & Git Config Metadata Access Prevention | `src/workspace/ignore.ts:13-14` |
| **SEC-POST-05** | **VERIFIED FIXED** | Clean | Secret Leakage | Modern API Key Redaction (`sk-proj-`, `sk-ant-`, `AIza`, GitHub, AWS) | `src/execution/sanitize.ts:12-22, 35-43` |
| **SEC-POST-06** | **VERIFIED FIXED** | Clean | Secret Leakage | Extended Sensitive File Pattern Blacklist Coverage | `src/workspace/ignore.ts:12-58` |
| **SEC-POST-07** | **VERIFIED FIXED** | Clean | Authentication Bypass | Loopback Admin Protection & Proxy Header Spoofing Prevention | `src/bridge/server.ts:98, 140-152` |
| **SEC-POST-08** | **LOW** | Open | OAuth 2.1 Hardening | Refresh Token Rotation Family Invalidation on Replay (RFC 6819) | `src/auth/store.ts:222-240` |
| **SEC-POST-09** | **LOW** | Open | Resource Management | Unbounded In-Memory `pendingRequests` Map under DoS | `src/auth/oauth.ts:139, 235` |
| **SEC-POST-10** | **INFORMATIONAL** | Mitigated | Prompt Injection | Indirect Prompt Injection from Untrusted Workspace Files | `src/mcp/server.ts:12-15`<br>`skill/SKILL.md:488-613` |
| **SEC-POST-11** | **INFORMATIONAL** | Mitigated | Network Architecture | Ephemeral Cloudflare Quick Tunnel Hostname Lifecycle | `src/tunnel/cloudflared.ts:40-52`<br>`src/config/endpoint.ts:48-55` |
| **SEC-POST-12** | **INFORMATIONAL** | Clean | Model Credentials | Zero Model API Keys or 9Router Credential Exposure | `src/bridge/server.ts:1-256`<br>`src/mcp/server.ts:1-330` |

---

## 3. Deep-Dive Security Verification by Domain

### 3.1. Secret Leakage & File Boundary Controls

#### A. Sensitive Pattern Matching & Case Normalization
- **Implementation:** `src/workspace/ignore.ts:12-58` defines `SENSITIVE_PATTERNS` containing comprehensive credential indicators:
  - `.git/`, `.git/**`, `.git-credentials`
  - `.env`, `.env.*`, `*.env`, `.envrc`, `!.env.example`
  - `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.ppk`
  - `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `id_dsa*`
  - `.ssh/`, `.aws/`, `.gnupg/`, `.kube/`, `kubeconfig`, `.docker/config.json`, `.cloudflared/`, `.vault-token`
  - `.npmrc`, `.netrc`, `_netrc`, `credentials.json`, `client_secret*.json`, `service-account*.json`, `secrets.json`, `.c2c-secrets*`
- **Case Handling:** `src/workspace/ignore.ts:5-6` sets `CASE_INSENSITIVE` for Windows and Darwin. When initializing `this.sensitive` (lines 95-96) and checking `isSensitive()` (lines 110-115), all paths and patterns are normalized via `normCase()`.
- **Verification:** Tested against `.ENV`, `.Env`, `SECRETS.JSON`, `Credentials.json`, `ID_RSA`, and `.NPMRC`. All are strictly blocked with `ACCESS_DENIED_SENSITIVE_FILE`.

#### B. Windows NTFS ADS & Trailing Dot Protection
- **Implementation:** `src/workspace/manager.ts:134-151`:
  - Lines 134-141: Detects and rejects any colon `:` outside of a Windows drive letter prefix (e.g. `C:/`), neutralizing `::$DATA`, `:$DATA`, and `:stream` Alternate Data Streams.
  - Lines 143-151: Splits normalized paths into segments and rejects any segment ending with trailing dots (`.`) or trailing spaces (` `) before filesystem access.
- **Verification:** Attempts to access `.env::$DATA`, `secrets.json::$DATA`, `.env.`, `.env..`, or `secrets.json.` throw `WorkspaceError("INVALID_PATH")` immediately.

#### C. Path Traversal & Symlink Escapes
- **Implementation:** `src/workspace/manager.ts:102-116, 153-164`:
  - `canonicalize()` uses `fs.realpathSync.native()` across path ancestors to resolve symlinks before containment checks.
  - `contains()` checks canonical path containment against canonical root with case awareness.
  - Relative path verification confirms `!rel.startsWith("..")`.
- **Verification:** Path traversal inputs (`../../etc/passwd`, `....//....//windows/win.ini`, symlinks pointing to `/` or `~/.ssh`) are blocked with `PATH_OUTSIDE_WORKSPACE`.

#### D. Git Metadata & Rename Provenance in Diffs
- **Implementation:** `src/workspace/git.ts:188-302`:
  - Diff inventory is retrieved using NUL-separated `-z` output with rename detection (`--find-renames=1%`).
  - Lines 221-224: When a rename/copy occurs (`R` or `C`), **both** the old path and new path are evaluated against `ignoreRules.isSensitive()`. If either side matches a sensitive file, the diff is suppressed.
  - Path-scoped diffs (e.g. `path: "src"`) verify provenance so that renaming a root secret (`.npmrc` -> `src/public.txt`) cannot leak secret diffs into scoped queries.
- **Verification:** 100% verified across unstaged, staged, and HEAD diff modes in `tests/git.test.ts` and `tests/mcp-integration.test.ts`.

---

### 3.2. MCP Architecture & Read-Only Invariant Enforcement

#### A. Tool Definitions
- **File:** `src/mcp/server.ts:58-328`
- **Exposed Tools:**
  1. `workspace_info`: Inspects project metadata (language, framework, git branch).
  2. `list_directory`: Lists directory entries with depth/pagination limits; excludes noise and sensitive items.
  3. `read_file`: Line-paginated text file reader with binary file rejection (`isBinary()`) and sensitive file denial.
  4. `search_workspace`: Ripgrep/Node text search, excluding noise and sensitive directories.
  5. `git_status`: Structured branch and staged/unstaged change status.
  6. `git_diff`: Byte-paginated git diffs with literal pathspec isolation and sensitive file exclusion.
  7. `test_status`: Reads latest execution record summary.
  8. `execution_summary`: Reads recent execution metadata records.
  9. `execution_output`: Reads sanitized command execution outputs.
- **Verification:** Zero mutation or execution tools. No tools take shell strings, execute arbitrary binaries, or write files.

#### B. Child Process Safety
- All child process calls (`src/workspace/git.ts:12`, `src/workspace/search.ts:80`, `src/tunnel/detect.ts:33`, `src/tunnel/cloudflared.ts:119`, `src/tunnel/cloudflared-named.ts:75`, `src/tunnel/named-provision.ts:103, 166`, `src/process/daemon.ts:53`) pass arguments as strictly typed arrays (`string[]`). `shell: true` is never used.

---

### 3.3. Authentication, OAuth 2.1, and Pairing Protocol

#### A. Dynamic Client Registration (DCR) & Redirect URI Validation
- **File:** `src/auth/oauth.ts:164-190`
- `isAllowedRedirectUri()` (lines 28-40) validates that `redirect_uris` are HTTPS or `http://localhost`/`http://127.0.0.1`.
- Registered client metadata is saved securely with owner-only permissions.

#### B. Authorization & Pairing Verification
- **File:** `src/auth/oauth.ts:194-290`, `src/pairing/manager.ts:67-162`
- Mandatory PKCE with `code_challenge_method: "S256"` (plain rejected).
- Pairing codes generated via CSPRNG from a 31-character non-ambiguous alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`), yielding ~40 bits of entropy.
- Pairing codes are verified via `timingSafeEqual()` against SHA-256 digests.
- **One-Time Consumption:** Pairing sessions are destroyed immediately upon successful verification.
- **Lockout:** Sessions are destroyed after 5 failed attempts.
- **TTL:** 5-minute hard expiration.

#### C. Token Issuance, Storage, and Rotation
- **File:** `src/auth/store.ts:167-271`
- Tokens (`c2c_at_*`, `c2c_rt_*`) are generated using 32 bytes of CSPRNG entropy (`randomBytes(32)`).
- Raw tokens are NEVER stored on disk; only `sha256hex(token)` hashes are stored in OS-protected runtime state files (`0600` permissions).
- Access tokens expire in 1 hour; refresh tokens expire in 30 days.
- Refresh operations rotate the token pair immediately: old refresh token is marked revoked and deleted from the active store.

#### D. Admin API Guard & Proxy Isolation
- **File:** `src/bridge/server.ts:98, 140-152`
- `app.set("trust proxy", "loopback")` prevents unauthorized proxy IP spoofing.
- `adminGuard` checks:
  1. `req.socket.remoteAddress` is strictly loopback (`127.0.0.1`, `::1`, or `::ffff:127.0.0.1`).
  2. No proxy headers exist (`!req.headers["cf-connecting-ip"] && !req.headers["x-forwarded-for"]`).
  3. `Authorization: Bearer <adminToken>` matches the 24-byte random CSPRNG admin token generated at bridge startup.
- Unmet criteria return `404 Not Found` without disclosing the endpoint existence.

---

### 3.4. Execution Output Sanitization & Redaction

#### A. Private Key Interception
- **File:** `src/execution/sanitize.ts:6-10, 66-68`
- Any command output containing RSA, EC, DSA, OpenSSH, or PGP private key headers is immediately flagged with `allowed: false, reason: "private_key"`.
- `readExecutionOutput()` refuses to return bodies for restricted outputs (`OUTPUT_RESTRICTED`).

#### B. High-Entropy Secret & Token Redaction
- **File:** `src/execution/sanitize.ts:12-22, 35-43`, `src/logger/index.ts:11-24`
- Regex patterns redact:
  - OpenAI Project keys: `sk-proj-[A-Za-z0-9_-]{20,}`
  - Anthropic API keys: `sk-ant-[A-Za-z0-9_-]{20,}`
  - Legacy OpenAI keys: `sk-[A-Za-z0-9]{20,}`
  - GitHub PATs: `ghp_[A-Za-z0-9]{20,}`, `github_pat_[A-Za-z0-9_]{20,}`
  - Google API keys: `AIza[0-9A-Za-z_-]{20,}`
  - Slack tokens: `xox[baprs]-[A-Za-z0-9-]{10,}`
  - AWS Access Key IDs: `AKIA[0-9A-Z]{16}`
  - Generic secrets: `api_key: ...`, `secret = ...`, `password: ...`, `authorization: ...`
  - Bearer tokens: `c2c_at_*`, `c2c_rt_*`, `c2c_admin_*`, `Bearer ...`
  - Pairing codes: `XXXX-XXXX`
  - Filesystem home paths: `/Users/*`, `/home/*`, `C:\Users\*` -> `~/[user]`

#### C. Buffer and Line Clamping
- Max 200 lines and max 64 KB output buffer with explicit `…[truncated]` markers.

---

### 3.5. Model Credentials & 9Router Isolation

- **Verification:** The codebase does not connect to or store 9Router, OpenAI, Anthropic, or other third-party LLM API keys directly.
- The C2C architecture relies exclusively on ChatGPT Web communicating over the OAuth-protected MCP interface.
- No model API keys are required or exposed in the bridge runtime or configuration files.

---

## 4. Residual Observations & Hardening Recommendations

### SEC-POST-08: Refresh Token Rotation Family Invalidation on Replay (RFC 6819)
- **Severity:** LOW
- **File:** `src/auth/store.ts:222-240`
- **Observation:** When a refresh token is rotated, `this.tokens.delete(record.hash)` deletes the old token record. If an attacker later presents the previously-used refresh token, `store.refresh()` returns `{ ok: false, reason: "invalid_grant" }` because the token is unknown.
- **Hardening Consideration:** Under RFC 6819 §5.2.2.3, if a previously-used (rotated) refresh token is submitted, the authorization server can treat the client session as potentially compromised and revoke all active tokens belonging to that client/grant family.
- **Practical Risk in Context:** Minimal, because each workspace bridge operates as a single-tenant local server with one active paired client and short-lived tokens.

### SEC-POST-09: Unbounded In-Memory `pendingRequests` Map under DoS
- **Severity:** LOW
- **File:** `src/auth/oauth.ts:139, 235`
- **Observation:** `pendingRequests` in `createOAuthRouter` stores authorization sessions in a `Map<string, PendingAuthRequest>`. Entries expire after 10 minutes and are pruned on subsequent `/oauth/authorize` calls.
- **Hardening Consideration:** If an external client floods `/oauth/authorize` with distinct requests without submitting pairing codes, the map size could temporarily grow during the 10-minute window.
- **Remediation:** Enforce a hard cap (e.g. max 50 pending authorization requests) with LRU eviction.

### SEC-POST-10: Indirect Prompt Injection from Untrusted Workspace Files
- **Severity:** INFORMATIONAL
- **File:** `src/mcp/server.ts:12-15`, `skill/SKILL.md:488-613`
- **Observation:** ChatGPT reads untrusted repository files, commit messages, and diffs via MCP tools. Malicious content within a repository could attempt indirect prompt injection against ChatGPT's planning responses.
- **Mitigation in Place:** 
  1. `UNTRUSTED_NOTE` is embedded in all MCP tool descriptions and system instructions.
  2. The MCP interface is strictly read-only; ChatGPT cannot directly invoke mutating tools.
  3. Claude Code / Codex verifies plan steps locally before executing them.

---

## 5. Security Regression Test Suite Results

All security regression tests were executed and passed successfully:

```
Test Files  16 passed (16)
     Tests  178 passed (178)
```

Key security test suites verified:
1. `tests/security-redteam.test.ts`:
   - SEC-01: Windows NTFS Alternate Data Streams (`::$DATA`, `:stream`) rejection.
   - SEC-02: Trailing dot (`.env.`, `.env..`) and whitespace segment rejection.
   - SEC-03: Case-insensitive sensitive file matching on Windows and macOS.
   - SEC-04: `.git/config` and internal Git file blocking.
   - SEC-05: Modern API key regex redaction in output sanitizer (`sk-proj-`, `sk-ant-`, `AIza`, GitHub, AWS, Slack, Bearer).
   - SEC-06: Extended sensitive file patterns coverage (`.envrc`, `dev.env`, `id_ed25519_sk`, `kubeconfig`, `putty.ppk`, `.vault-token`).
   - SEC-07: Trust proxy isolation and loopback admin protection.
2. `tests/mcp-integration.test.ts`:
   - MCP 9 read-only tool verification and write/exec tool absence.
   - Scope enforcement per tool (`workspace.read`, `workspace.search`, `git.read`, `execution.read`).
   - Git diff sensitive file exclusion and cross-boundary rename provenance safety.
3. `tests/oauth.test.ts` & `tests/pairing.test.ts`:
   - PKCE S256 enforcement.
   - One-time pairing code consumption, lockout on 5 failed attempts, and IP rate limiting.
   - Token hashing at rest and refresh token rotation.

---

## 6. Audit Conclusion & Final Verdict

**Final Security Posture:** **SECURE & VERIFIED ENFORCED**

The post-implementation review confirms that `codex-with-chatgpt` (`c2c-bridge`) enforces absolute defense-in-depth:
- The read-only invariant is structurally maintained across all MCP endpoints.
- Path canonicalization and platform-specific path parsing protections (NTFS ADS, trailing dots, case normalization) prevent sensitive file exfiltration.
- Cryptographic pairing, PKCE OAuth 2.1, and loopback admin isolation protect the bridge from network and proxy attacks.
- Execution logs and outputs are thoroughly sanitized.

**Report Status:** COMPLETE  
**Auditor:** `security-reviewer`  
**File Created:** `D:\claude-code-with-chatgpt\SECURITY_AUDIT_POST.md`
