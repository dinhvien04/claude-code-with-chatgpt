# Adversarial Test Review & Failure Mode Analysis

**Product / System**: `codex-with-chatgpt` (`c2c-bridge`)  
**Reviewer Role**: `adversarial-test-reviewer`  
**Review Date**: 2026-09-01  
**Scope**: Complete static, behavioral, and architectural review of `src/` against all existing regression suites in `tests/`.

---

## Executive Summary & Threat Model

`codex-with-chatgpt` provides a security-critical bridge exposing local developer workspace files, git status/diffs, and command execution summaries to ChatGPT via the Model Context Protocol (MCP) over a Cloudflare tunnel.

The security and reliability invariants of this architecture are:
1. **Confidentiality**: Sensitive workspace assets (`.env`, SSH keys, credentials, tokens, internal `.git` metadata) must **never** be exposed via MCP tools (`read_file`, `list_directory`, `search_workspace`, `git_diff`), execution output logs, or OAuth web views.
2. **Containment**: Arbitrary file access, path traversal, symlink escapes, or directory climbing must be strictly impossible.
3. **Availability & Resilience**: The daemon, local bridge, and background tunnel must tolerate corrupted files, huge data payloads, network dropouts, process crashes, and unexpected file system topologies without deadlocking or failing open.
4. **Platform Parity**: Identical security and functional semantics across Windows, macOS, and Linux.

While the existing test suite (`tests/security-redteam.test.ts`, `tests/workspace.test.ts`, `tests/oauth.test.ts`, etc.) covers baseline functionality and initial red-team regressions (SEC-01 through SEC-07), this deep adversarial audit identified **28 critical and edge-case blindspots** across 9 structural categories.

---

## Detailed Vulnerability & Edge Case Analysis

---

### Category 1: Path Traversal, Canonicalization & File System Boundaries

#### 1.1 Case-Sensitive Bypass on `HARD_REJECT` in Sanitizer
* **Location**: `src/execution/sanitize.ts:6-10`
* **Vulnerability**:
  ```ts
  const HARD_REJECT: RegExp[] = [
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    /-----BEGIN OPENSSH PRIVATE KEY-----/,
    /-----BEGIN PGP PRIVATE KEY BLOCK-----/,
  ];
  ```
  The regexes in `HARD_REJECT` **lack the `/i` case-insensitive flag**. If tool output prints lower-case or mixed-case headers (e.g. `-----begin rsa private key-----` or `-----begin private key-----` produced by certain OpenSSL wrappers, Python libraries, or debug scripts), `HARD_REJECT.some(...)` evaluates to `false`. Furthermore, `REDACT_PATTERNS` in `src/logger/index.ts:12-16` has no rule matching PEM blocks. Consequently, lower-cased private keys will bypass the hard-rejection gate and be served directly to ChatGPT.
* **Missing Test**: No test in `tests/execution-output.test.ts` or `tests/security-redteam.test.ts` asserts lower-case or mixed-case PEM blocks.

#### 1.2 Windows Drive Letter & Slashes in `redactHomePaths`
* **Location**: `src/execution/sanitize.ts:28-33`
* **Vulnerability**:
  ```ts
  function redactHomePaths(text: string): string {
    return text
      .replace(/\/Users\/[^/\s"'`]+/g, "/Users/[user]")
      .replace(/\/home\/[^/\s"'`]+/g, "/home/[user]")
      .replace(/C:\\Users\\[^\\\s"'`]+/gi, String.raw`C:\Users\[user]`);
  }
  ```
  1. Windows home directories residing on non-C drives (e.g. `D:\Users\developer\...` or `E:\Users\...`) are completely missed.
  2. Windows paths formatted with forward slashes (e.g. `C:/Users/developer/...`, frequently emitted by Node.js, Git Bash, MSYS2, Python, and CMake) are not matched because the regex strictly looks for backslashes `C:\\Users\\`.
* **Missing Test**: Tests only assert `C:\Users\charlie` with backslashes on drive `C:`.

#### 1.3 DOS 8.3 Short File Names (SFN) on Windows
* **Location**: `src/workspace/manager.ts:122-172`, `src/workspace/ignore.ts:110-114`
* **Vulnerability**:
  On Windows NTFS volumes with short filename generation enabled (the default on system drives), files have 8.3 aliases (e.g., `secrets.json` -> `SECRETS~1.JSO`, `credentials.json` -> `CREDENTIALS~1.JSO`, `.env.production` -> `ENV~1.PRO`).
  While `fs.realpathSync.native` expands 8.3 short names if the file exists on disk, `IgnoreRules.isSensitive` evaluates strings against `SENSITIVE_PATTERNS` which only contain long names. If a path check occurs prior to full resolution or on non-canonicalized segments, or if a user inputs an 8.3 alias into custom `.c2cignore` rules, short-name bypasses can occur.
* **Missing Test**: No test creates and queries files via 8.3 SFN aliases on Windows.

#### 1.4 Windows Reserved Device Names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
* **Location**: `src/workspace/manager.ts:122-172`, `src/workspace/manager.ts:195`
* **Vulnerability**:
  On Windows, filenames matching DOS device names (e.g., `CON`, `PRN`, `AUX`, `NUL`, `COM1`, `LPT1`, or `CON.txt`) refer to legacy system devices.
  Attempting `fs.promises.stat("CON")` or opening `fs.createReadStream("CON")` can hang the Node.js event loop or cause an OS-level device error.
  `manager.resolve()` checks for colons and trailing dots/spaces, but does not sanitize DOS device names.
* **Missing Test**: No test attempts resolving or reading `CON`, `NUL`, `AUX`, or `COM1.ts`.

#### 1.5 Legitimate Unix Path Segments with Trailing Dots or Spaces
* **Location**: `src/workspace/manager.ts:144-151`
* **Vulnerability**:
  ```ts
  const segments = p.split("/");
  for (const seg of segments) {
    if (seg !== "." && seg !== ".." && seg !== "") {
      if (seg.endsWith(".") || seg.endsWith(" ")) {
        throw new WorkspaceError("INVALID_PATH", "Invalid path: trailing dots and spaces in path segments are forbidden");
      }
    }
  }
  ```
  While trailing dots and spaces are invalid on Windows NTFS and were blocked to prevent SEC-02 bypasses, Linux and macOS file systems natively support directory and file names ending with dots or spaces (e.g. `docs/v1.0./spec.md` or `notes/draft `). This blanket rejection breaks valid POSIX paths on non-Windows platforms.
* **Missing Test**: No test validates cross-platform behavior of trailing dots/spaces on Linux/macOS.

#### 1.6 Unicode Normalization (NFC vs NFD) on macOS APFS/HFS+
* **Location**: `src/workspace/manager.ts:86`, `src/workspace/ignore.ts:110-114`
* **Vulnerability**:
  macOS file systems (HFS+/APFS) decompose Unicode characters (NFD), whereas Linux/Windows typically preserve precomposed Unicode (NFC).
  `IgnoreRules.isSensitive(relPath)` performs string matching via the `ignore` package without first normalizing Unicode strings with `.normalize("NFC")`.
  If a rule in `.c2cignore` contains NFC characters (e.g. `privat-café/`) and a query arrives in NFD format, `isSensitive` will return `false`, failing to block access.
* **Missing Test**: No test tests NFC vs NFD unicode paths in `manager.resolve` or `IgnoreRules`.

---

### Category 2: Symbolic Link Topologies & Inconsistencies

#### 2.1 Symlinks Inside Workspace Silently Skipped by Directory Listing and Search
* **Location**: `src/workspace/manager.ts:284-295`, `src/workspace/search.ts:139-142`
* **Vulnerability**:
  In `listDirectory`:
  ```ts
  entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
  ...
  for (const entry of entries) {
    ...
    if (entry.isDirectory()) {
      all.push({ path: childRel + "/", type: "dir" });
      if (level < depth) await walk(path.join(dirAbs, entry.name), childRel, level + 1);
    } else if (entry.isFile()) {
      ...
      all.push({ path: childRel, type: "file", sizeBytes: size });
    }
  }
  ```
  In Node.js, `Dirent.isDirectory()` and `Dirent.isFile()` return `false` for symbolic links (`entry.isSymbolicLink()` is true).
  Consequently, **any legitimate internal symlink within the workspace** (e.g. a symlink `src/shared -> ../packages/shared` or `index.ts -> app.ts`) is **completely and silently omitted** from both `list_directory` results and `search_workspace` (Node engine).
* **Missing Test**: No test in `tests/workspace.test.ts` or `tests/search.test.ts` checks directory listing or search for valid intra-workspace symlinks.

#### 2.2 Circular Symlink Error Code Mapping (`ELOOP` -> `FILE_NOT_FOUND`)
* **Location**: `src/workspace/manager.ts:193-198`
* **Vulnerability**:
  When resolving a circular symlink (`link_a -> link_b -> link_a`), `fs.promises.stat(abs)` throws `ELOOP: too many symbolic links encountered`.
  `manager.readFile` catches all errors from `stat` and unconditionally throws `FILE_NOT_FOUND` ("File not found: link_a").
  This misleads API consumers and ChatGPT into assuming the path does not exist rather than diagnosing a recursive symlink loop.
* **Missing Test**: No test verifies error code handling on cyclic filesystem graphs.

---

### Category 3: Sensitive File Policies, Ignore Rules & Git Metadata

#### 3.1 Submodule and Git Worktree `.git` File Exposure
* **Location**: `src/workspace/ignore.ts:13-14`
* **Vulnerability**:
  In `SENSITIVE_PATTERNS`:
  ```ts
  export const SENSITIVE_PATTERNS: string[] = [
    ".git/",
    ".git/**",
    ...
  ];
  ```
  In Git submodules and secondary git worktrees (`git worktree add`), `.git` is **not a directory**; it is a regular text file containing `gitdir: /path/to/main/repo/.git/worktrees/...`.
  The gitignore pattern `.git/` with a trailing slash matches **directories only**. Because `.git` is a file in worktrees/submodules, `isSensitive(".git")` evaluates to `false`.
  An MCP client can call `read_file(path: ".git")` and leak internal host filesystem paths and repository topology.
* **Missing Test**: No test in `tests/workspace.test.ts` or `tests/security-redteam.test.ts` attempts reading `.git` as a file in a submodule or worktree context.

#### 3.2 Lack of Nested `.c2cignore` Support in Monorepos
* **Location**: `src/workspace/ignore.ts:98-106`
* **Vulnerability**:
  `IgnoreRules` only reads `.c2cignore` located at the root of the workspace (`path.join(workspaceRoot, ".c2cignore")`).
  In monorepos where sub-packages contain their own `.c2cignore` files (e.g., `packages/api/.c2cignore` containing package-level secrets), these nested rules are completely ignored by the bridge.
* **Missing Test**: No test validates nested `.c2cignore` inheritance or scoping.

#### 3.3 Dynamic `.c2cignore` Modifications Ignored During Runtime
* **Location**: `src/workspace/manager.ts:87`, `src/bridge/server.ts:84`
* **Vulnerability**:
  `this.ignoreRules = new IgnoreRules(real)` is constructed once when the `Workspace` instance is initialized at bridge boot.
  If a developer or Claude Code session updates `.c2cignore` to protect a new confidential directory while the bridge daemon is running, the bridge never reloads the rules. Newly ignored files remain readable through MCP until the daemon is manually restarted.
* **Missing Test**: No test modifies `.c2cignore` after bridge initialization to test live cache invalidation.

#### 3.4 Case-Insensitive Ignore Rules Bypassed on Linux Case-Insensitive Mounts
* **Location**: `src/workspace/ignore.ts:5-6`
* **Vulnerability**:
  `const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";`
  On Linux systems mounting case-insensitive filesystems (FAT32, NTFS, CIFS/Samba, or ext4 with `+F` casefold directory attribute enabled), `CASE_INSENSITIVE` is `false`.
  If a sensitive file on Linux is named `.ENV` or `SECRETS.JSON`, `isSensitive(".ENV")` will not lower-case the path and will fail to match `.env` or `secrets.json`, leaking the file.
* **Missing Test**: No test exercises case-insensitive sensitive matching under simulated Linux platform flags.

---

### Category 4: Content Limits, Huge Files & Stream Starvation

#### 4.1 Unbounded Line Counting on Multi-Gigabyte Files
* **Location**: `src/workspace/manager.ts:219-234`
* **Vulnerability**:
  ```ts
  const stream = fs.createReadStream(abs, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    totalLines++;
    if (totalLines >= startLine && totalLines <= endLimit && !byteTruncated) {
      ...
    }
  }
  rl.close();
  ```
  Even when reading `start_line: 1, end_line: 10`, `for await (const line of rl)` continues streaming and counting **every single line of the file until EOF** to compute `totalLines`.
  If an MCP client requests line 1-10 of a 20GB log file or database dump, the bridge reads the entire 20GB into memory/CPU line-by-line, starving the Node.js event loop and causing severe latency or process termination.
* **Missing Test**: No test reads the first page of a large multi-megabyte file to verify stream early-termination.

#### 4.2 Single Ultra-Long Line Bypassing `maxBytes` Limit
* **Location**: `src/workspace/manager.ts:223-231`
* **Vulnerability**:
  ```ts
  if (totalLines >= startLine && totalLines <= endLimit && !byteTruncated) {
    const cost = Buffer.byteLength(line, "utf8") + 1;
    if (collectedBytes + cost > maxBytes && lines.length > 0) {
      byteTruncated = true;
    } else {
      lines.push(line);
      collectedBytes += cost;
      actualEnd = totalLines;
    }
  }
  ```
  Notice the check `if (collectedBytes + cost > maxBytes && lines.length > 0)`.
  If line 1 is a minified JavaScript bundle, single-line JSON, or data URI of 50MB (`lines.length === 0`), the condition evaluates to `false`. Line 1 is pushed into `lines` regardless of its size, completely bypassing `maxBytes` (default 256KB, hard cap 1MB) and producing a massive MCP response that can crash the HTTP handler or MCP client.
* **Missing Test**: No test reads a file containing a single 5MB line without newlines.

#### 4.3 0-Byte Empty File Index Reporting
* **Location**: `src/workspace/manager.ts:241-247`
* **Vulnerability**:
  For an empty 0-byte file, `totalLines` is `0`.
  `startLine` evaluates to `Math.min(startLine, Math.max(totalLines, 1))` -> `1`.
  `actualEnd` remains `startLine - 1` -> `0`.
  The function returns `{ startLine: 1, endLine: 0, totalLines: 0, content: "" }`.
  Returning `endLine < startLine` (`startLine: 1, endLine: 0`) violates standard 1-based indexing expectations in downstream MCP tools.
* **Missing Test**: No test in `tests/workspace.test.ts` asserts `readFile` against a 0-byte file.

#### 4.4 UTF-16 Surrogate Pair Splitting in Output Truncator
* **Location**: `src/execution/sanitize.ts:53-60`
* **Vulnerability**:
  ```ts
  if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) {
    let cut = next;
    while (Buffer.byteLength(cut, "utf8") > MAX_OUTPUT_BYTES && cut.length > 0) {
      cut = cut.slice(0, Math.floor(cut.length * 0.9));
    }
    next = `${cut}\n…[truncated]`;
    truncated = true;
  }
  ```
  `cut.slice(...)` slices across UTF-16 code units. If the cut lands between a high surrogate and a low surrogate (e.g. multi-byte Unicode emojis, math symbols, or CJK ideographs), it creates a malformed, unpaired surrogate, causing encoding errors or `\uFFFD` replacement corruption when transmitted over JSON-RPC.
* **Missing Test**: No test truncates execution outputs containing high-density 4-byte UTF-8 emoji strings.

---

### Category 5: Execution Tracking, Concurrency & JSONL Data Integrity

#### 5.1 Trailing Line Corruption Cascades in Execution Records
* **Location**: `src/execution/records.ts:34-47`
* **Vulnerability**:
  ```ts
  export function readExecutionRecords(workspaceId: string, limit = 10): ExecutionRecord[] {
    const file = recordsFile(workspaceId);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    const records: ExecutionRecord[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        records.push(JSON.parse(line) as ExecutionRecord);
      } catch {
        // skip corrupt lines
      }
    }
    return records;
  }
  ```
  `lines.slice(-limit)` selects the last `N` lines of the file **before** parsing them.
  If the last 2 lines in a 100-line JSONL file are corrupted (e.g. from an abrupt SIGKILL or power outage during write), `readExecutionRecords(workspaceId, 2)` attempts to parse only those 2 corrupt lines, skips both, and returns `[]`.
  Calling `latestExecutionRecord(workspaceId)` calls `readExecutionRecords(workspaceId, 1)`, which returns `null` ("No execution records yet"), completely hiding all 98 valid prior records.
* **Missing Test**: No test asserts `readExecutionRecords` or `latestExecutionRecord` behavior when the file ends with a torn/half-written JSON line.

#### 5.2 Read-Modify-Write Race Condition in Execution Output Store
* **Location**: `src/execution/output.ts:60-98`
* **Vulnerability**:
  `saveExecutionOutput` reads `index.json`, increments `nextId`, appends metadata to `items`, writes `bodies/<id>.txt`, and writes `index.json`.
  There is **no filesystem lock** (`flock` or lockfile). If multiple tasks or test commands finish simultaneously, concurrent invocations overwrite `index.json`, leading to duplicate IDs, dropped metadata, or orphaned body files on disk.
* **Missing Test**: No test performs concurrent `saveExecutionOutput` writes.

#### 5.3 Stale Body Deletion on Reset Index
* **Location**: `src/execution/output.ts:39-45`
* **Vulnerability**:
  If `index.json` is wiped or corrupted to 0 bytes, `readIndex` falls back to `{ nextId: 1, items: [] }`.
  When a new record is saved, it writes `bodies/1.txt`, silently overwriting any existing body file `1.txt` that belonged to a previous session.
* **Missing Test**: No test tests recovery behavior when `index.json` is missing or corrupted.

---

### Category 6: Git State Anomalies & Diff Scalability

#### 6.1 Unborn HEAD (Initial Commit / 0 Commits) Misreported as `isRepo: false`
* **Location**: `src/workspace/git.ts:188-209`, `src/mcp/server.ts:205-224`
* **Vulnerability**:
  In a freshly initialized Git repository (`git init`) where no commit has been made yet (unborn HEAD):
  - `git status --porcelain=v2` succeeds (`gitStatus` correctly returns `isRepo: true`).
  - BUT when calling `git_diff` with `mode: "head"`, `runGit` runs `git diff ... HEAD -- .`.
  - In an unborn repo, `git diff HEAD` fails with fatal exit code 128 (`fatal: bad revision 'HEAD'`).
  - `gitDiff` checks `if (!listResult.ok) return { isRepo: false, ... }`.
  - `git_diff` reports `isRepo: false`, falsely claiming to ChatGPT that the workspace is not a Git repository!
* **Missing Test**: No test in `tests/git.test.ts` runs `gitDiff` with `mode: "head"` on a repo with 0 commits.

#### 6.2 Regex SyntaxError in Node Search Engine
* **Location**: `src/workspace/search.ts:120`, `src/mcp/server.ts:160-168`
* **Vulnerability**:
  In `searchWithNode`:
  ```ts
  const matcher = opts.regex ? new RegExp(opts.query, "i") : null;
  ```
  If ChatGPT or a user provides an invalid regular expression (e.g. `query: "[unclosed-bracket("`, `regex: true`), `new RegExp(...)` throws an unhandled `SyntaxError`.
  While `mcp/server.ts` catches this and maps it to `INTERNAL_ERROR`, `searchWithNode` fails abruptly instead of returning a clean client error.
* **Missing Test**: No test in `tests/search.test.ts` executes `searchWorkspace` with invalid regex patterns.

#### 6.3 Buffer Overflow on Massive Git Repositories
* **Location**: `src/workspace/git.ts:11-17`
* **Vulnerability**:
  `spawnSync("git", args, { maxBuffer: 64 * 1024 * 1024 })` has a 64MB buffer cap. In a monorepo with 500,000 changed files, `git diff --name-status -z` can exceed 64MB, causing `spawnSync` to crash with `ENOBUFS`. `runGit` returns `ok: false`, and `gitDiff` fails closed.
* **Missing Test**: No test mocks or tests `ENOBUFS` handling in `runGit`.

---

### Category 7: Control-Plane Resilience & Process Lifecycle

#### 7.1 Cloudflared Start Timeout Cascading to 90-Second CLI Freeze
* **Location**: `src/tunnel/cloudflared.ts:74`, `src/cli/index.ts:178`
* **Vulnerability**:
  `CloudflaredQuickTunnel` defaults `startTimeoutMs` to 45,000ms (45s).
  In `src/cli/index.ts:178`, `adminFetch(runtime, "POST", "/admin/tunnel/start", 90_000)` allows 90 seconds.
  If the network is blocked, DNS fails, or cloudflared cannot reach Cloudflare edge servers, the CLI process hangs completely for up to 90 seconds before surfacing an error to the user.
* **Missing Test**: No test verifies fast-fail behavior when network sockets are unroutable.

#### 7.2 Stale Runtime State PID Collision & Permanent Daemon Lock
* **Location**: `src/bridge/runtime.ts:74-82`, `src/process/daemon.ts:36-40`
* **Vulnerability**:
  If the bridge crashes or is abruptly killed, `runtime/<workspaceId>.json` remains on disk.
  If the OS later reassigns the same PID to an unrelated long-running process (e.g. a browser or database):
  1. `observePid(runtime.pid)` calls `process.kill(pid, 0)` which returns `"present"`.
  2. `probeBridge(runtime.port)` fails because the port is closed or belongs to another service.
  3. `findBridgeObservation` returns `{ state: "unknown", reason: "probe_failed" }`.
  4. `ensureBridge` checks `if (observation.state === "unknown") throw new Error("Bridge state is uncertain...")`.
  5. The bridge **permanently refuses to start** for this workspace until the user manually deletes the file in `~/.local/state/...`.
* **Missing Test**: No test simulates a dead bridge with a recycled alive PID.

---

### Category 8: Authentication, Pairing State Machine & OAuth

#### 8.1 Unbounded OAuth Client Registration (RFC 7591 DoS)
* **Location**: `src/auth/oauth.ts:164-191`, `src/auth/store.ts:115-125`
* **Vulnerability**:
  The endpoint `POST /oauth/register` is completely unauthenticated and public.
  `store.registerClient` adds clients to `this.clients` and immediately calls `this.save()`, which performs synchronous disk I/O (`writeSecureJson`).
  An attacker on the public tunnel can flood `/oauth/register` with thousands of requests, exhausting disk space and locking the server with synchronous JSON file writes.
* **Missing Test**: No test asserts rate-limiting or storage bounds on dynamic client registration.

#### 8.2 Memory Leak in `pendingRequests` Map
* **Location**: `src/auth/oauth.ts:139`, `src/auth/oauth.ts:225-235`
* **Vulnerability**:
  `const pendingRequests = new Map<string, PendingAuthRequest>();`
  `prunePending()` is only executed when an authorization request arrives.
  An attacker can generate 500,000 requests to `GET /oauth/authorize` with a valid `client_id` and abandon them. All 500,000 `PendingAuthRequest` objects remain in memory for 10 minutes without any global map size limit.
* **Missing Test**: No test asserts memory bounds or eviction policies on `pendingRequests`.

#### 8.3 Timing Safe Comparison Missing in Admin Guard
* **Location**: `src/bridge/server.ts:147`
* **Vulnerability**:
  In `adminGuard`:
  `if (!isLoopback || viaProxy || token !== adminToken)`
  The comparison `token !== adminToken` uses JavaScript's standard string equality operator `!==` rather than `safeEqual` / `timingSafeEqual`.
  While loopback exploits are constrained, standard cryptographic hygiene requires constant-time comparisons for bearer admin tokens.
* **Missing Test**: No test checks constant-time comparison on admin token verification.

---

### Category 9: Cross-Platform (Windows vs macOS vs Linux) Semantic Divergence

#### 9.1 File Permissions `chmod` No-Op on Windows
* **Location**: `src/config/paths.ts:38-42`, `src/execution/output.ts:84-88`, `src/config/sandbox-allow.ts:83-87`
* **Vulnerability**:
  The codebase calls `fs.chmodSync(file, 0o600)` across sensitive files (`auth/<id>.json`, `runtime/<id>.json`, `bodies/<id>.txt`, `config.toml`).
  On Windows, `fs.chmodSync` does not set NTFS ACLs; it only sets the read-only file attribute. Any local user process running under the same or different standard accounts can read these files unless Windows-specific DACLs are applied (e.g. via `icacls`).
* **Missing Test**: No test verifies file confidentiality isolation on multi-user Windows environments.

#### 9.2 CRLF vs LF Handling in Line-Based Offset Calculators
* **Location**: `src/workspace/manager.ts:220`, `src/execution/sanitize.ts:46`
* **Vulnerability**:
  In `manager.readFile`: `crlfDelay: Infinity` normalizes line breaks in `readline`.
  However, in `sanitize.ts:46`: `text.split(/\r?\n/)` is used, while `truncate` recombines with `\n`.
  If a Windows log output uses `\r\n`, sanitization replaces line endings with `\n`, altering exact byte lengths and character offsets.
* **Missing Test**: No test verifies exact byte-offset consistency when roundtripping CRLF execution outputs.

---

## Adversarial Test Matrix

| ID | Domain | Target Component | Attack / Edge Case Vector | Severity | Current Test Coverage |
|---|---|---|---|---|---|
| **ADV-01** | Security | `execution/sanitize.ts` | Lowercase PEM headers (`-----begin rsa private key-----`) | **High** | ❌ Missed (Only uppercase tested) |
| **ADV-02** | Security | `execution/sanitize.ts` | Home path redaction on non-C drives (`D:\Users\x`) & forward slashes (`C:/Users/x`) | **High** | ❌ Missed (Only `C:\Users\` tested) |
| **ADV-03** | Security | `workspace/ignore.ts` | Submodule / worktree `.git` regular file reading (`readFile(".git")`) | **High** | ❌ Missed (Only `.git/` dir tested) |
| **ADV-04** | Security | `auth/oauth.ts` | Unauthenticated flood of `/oauth/register` causing disk write exhaustion | **High** | ❌ Missed |
| **ADV-05** | Availability | `workspace/manager.ts` | Stream starvation on 50GB file to count `totalLines` | **High** | ❌ Missed (Only 1,000 lines tested) |
| **ADV-06** | Availability | `workspace/manager.ts` | 50MB single line with no `\n` bypassing `maxBytes` | **High** | ❌ Missed |
| **ADV-07** | Availability | `process/daemon.ts` | Dead bridge with recycled PID locking `ensureBridge` permanently | **High** | ❌ Missed |
| **ADV-08** | Data Integrity | `execution/records.ts` | Corrupted trailing line hiding 100 valid historical execution records | **Medium** | ❌ Missed |
| **ADV-09** | Data Integrity | `execution/output.ts` | Concurrent `saveExecutionOutput` race condition corrupting `index.json` | **Medium** | ❌ Missed |
| **ADV-10** | Correctness | `workspace/git.ts` | 0-commit unborn repo returning `isRepo: false` on `git_diff(mode: "head")` | **Medium** | ❌ Missed |
| **ADV-11** | Correctness | `workspace/manager.ts` | Internal symlinks completely omitted from `listDirectory` & search | **Medium** | ❌ Missed |
| **ADV-12** | Correctness | `workspace/search.ts` | Uncaught `SyntaxError` on invalid regex query in Node search engine | **Medium** | ❌ Missed |
| **ADV-13** | Windows Parity | `workspace/manager.ts` | DOS device names (`CON`, `PRN`, `NUL`, `AUX`) hanging file stream | **Medium** | ❌ Missed |
| **ADV-14** | Windows Parity | `workspace/manager.ts` | DOS 8.3 short filename alias access (`SECRETS~1.JSO`) | **Medium** | ❌ Missed |
| **ADV-15** | Linux Parity | `workspace/manager.ts` | Rejection of legitimate POSIX files ending with dots/spaces | **Medium** | ❌ Missed |
| **ADV-16** | Linux Parity | `workspace/ignore.ts` | Case-insensitive sensitive file access on Linux casefold mounts | **Low** | ❌ Missed |
| **ADV-17** | Correctness | `workspace/manager.ts` | Empty 0-byte file returning inverted range `startLine: 1, endLine: 0` | **Low** | ❌ Missed |
| **ADV-18** | Correctness | `execution/sanitize.ts` | Truncation loop splitting UTF-16 surrogate pairs into malformed Unicode | **Low** | ❌ Missed |
| **ADV-19** | Memory | `auth/oauth.ts` | `pendingRequests` Map memory leak on uncompleted authorization requests | **Low** | ❌ Missed |
| **ADV-20** | Cryptography | `bridge/server.ts` | Non-constant time string comparison in `adminGuard` | **Low** | ❌ Missed |

---

## Recommended Remediation Priorities

### Immediate Security & Hardening Fixes (P0)

1. **Add Case-Insensitive Flag to `HARD_REJECT`**:
   * *File*: `src/execution/sanitize.ts:6-10`
   * *Fix*:
     ```ts
     const HARD_REJECT: RegExp[] = [
       /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/i,
       /-----BEGIN OPENSSH PRIVATE KEY-----/i,
       /-----BEGIN PGP PRIVATE KEY BLOCK-----/i,
     ];
     ```

2. **Fix `redactHomePaths` for All Drives & Slash Styles**:
   * *File*: `src/execution/sanitize.ts:28-33`
   * *Fix*:
     ```ts
     function redactHomePaths(text: string): string {
       return text
         .replace(/\/Users\/[^/\s"'`]+/g, "/Users/[user]")
         .replace(/\/home\/[^/\s"'`]+/g, "/home/[user]")
         .replace(/[a-zA-Z]:[/\\]Users[/\\][^/\\\s"'`]+/gi, "C:\\Users\\[user]");
     }
     ```

3. **Block Submodule / Worktree `.git` Files in Ignore Rules**:
   * *File*: `src/workspace/ignore.ts:13-14`
   * *Fix*: Add bare `".git"` to `SENSITIVE_PATTERNS`:
     ```ts
     export const SENSITIVE_PATTERNS: string[] = [
       ".git",
       ".git/",
       ".git/**",
       ...
     ];
     ```

4. **Rate Limit & Cap Client Registrations**:
   * *File*: `src/auth/oauth.ts:164`, `src/auth/store.ts:115`
   * *Fix*: Enforce a hard cap (e.g. max 50 clients) in `AuthStore` and rate-limit `POST /oauth/register`.

### Reliability & Resilience Fixes (P1)

5. **Fix Unbounded Line Streaming in `readFile`**:
   * *File*: `src/workspace/manager.ts:219-234`
   * *Fix*: Destroy the read stream when `totalLines > endLimit` and `byteTruncated` is reached instead of reading to EOF, or estimate `totalLines` for massive files.

6. **Fix `maxBytes` Single Line Bypass**:
   * *File*: `src/workspace/manager.ts:223-231`
   * *Fix*: Truncate the first line to `maxBytes` if `cost > maxBytes`:
     ```ts
     if (collectedBytes + cost > maxBytes) {
       byteTruncated = true;
       if (lines.length === 0) {
         lines.push(line.slice(0, Math.floor(maxBytes / 2)) + "…[truncated]");
         actualEnd = totalLines;
       }
     }
     ```

7. **Fix Resilient JSONL Parsing in `readExecutionRecords`**:
   * *File*: `src/execution/records.ts:34-47`
   * *Fix*: Filter valid JSON records backwards from the end of the file rather than slicing raw string lines before validation.

8. **Handle Unborn HEAD in `gitDiff`**:
   * *File*: `src/workspace/git.ts:197-209`
   * *Fix*: Check if repository has commits before passing `HEAD`; if repo is unborn, return empty diff with `isRepo: true`.

9. **Fix Symlink Traversal in `listDirectory`**:
   * *File*: `src/workspace/manager.ts:284-295`
   * *Fix*: Use `fs.promises.stat` on `entry.isSymbolicLink()` entries to determine if they target a file or directory within workspace bounds.
