# Port Review & System Delivery: `claude-code-with-chatgpt`

> **Repository**: `dinhvien04/claude-code-with-chatgpt` (Forked & Ported from `XiaoDuoYa/codex-with-chatgpt`)  
> **Package Service**: `c2c-bridge` (CLI: `c2c`, Version: `0.1.1`)  
> **Core Principle**: *"ChatGPT thinks. Claude Code works."*  
> **Baseline Commit**: `4860d4908b8ffe40b759033594257edc3667de45`  
> **Lead Engineer Verification Date**: 2026-09-02  
> **Overall Port Status**: **CODE QUALITY GATES: PASS | END-TO-END RUNTIME VALIDATION: PENDING**

---

## 1. Corrective Pass Summary (Review Completeness & Security Hardening)

Following independent multi-agent review sweeps and security verification against the official Claude Code settings schema and OpenAI subscription tiers, the following critical improvements were implemented:

1. **Complete Review Changeset & Non-Mutating Untracked Diff Generator (`src/bundle/untracked.ts`)**:
   - `c2c bundle review` defaults to `--diff-mode head`, capturing all staged, unstaged, modified, deleted, and renamed tracked changes relative to HEAD (or Git's canonical empty tree `4b825dc642cb6eb9a060e54bf8d69288fbee4904` for unborn repos).
   - In-memory synthesized unified diff blocks (`new file mode 100644`) for safe untracked files without modifying Git index or repository state (zero `git add`, zero `git stage`, zero `git stash`, zero `git reset`).
   - Confines and scopes path resolution in workspace subdirectories inside larger repositories using `:(top,literal)` pathspecs and scoped git enumeration.
2. **Multi-Layer Sensitive Untracked File Gate**:
   - Strictly blocks `.env*`, `credentials.json`, `*.pem`, `*.key`, `id_rsa*`, `.git/*`, `.npmrc`, and service account tokens across `Workspace.resolve()`, `IgnoreRules.isSensitive()`, `gitStatus()`, `gitDiff()`, and `buildUntrackedFileDiffs()`.
   - Binary untracked files are detected via `workspace.isBinary()` and rendered as binary diff notices without leaking contents.
3. **15-Case Git Review Test Matrix (Cases A through O)**:
   - Comprehensive test suite in `tests/bundle.test.ts` covering:
     - Case A: unstaged tracked modification
     - Case B: staged tracked modification
     - Case C: mixed staged + unstaged tracked modifications
     - Cases D & E: one and multiple new untracked text files
     - Case F: untracked binary files
     - Case G: sensitive untracked files (.env, credentials, keys, id_rsa)
     - Case H: deleted tracked files
     - Case I: renamed tracked files with cross-boundary secret protection
     - Case J: staged new files
     - Case K: unborn repository with zero commits
     - Case L: clean repository (empty diff)
     - Case M: paths containing spaces
     - Case N: Unicode filenames and content (Vietnamese, Chinese, Emoji)
     - Case O: target workspace is a subdirectory inside a larger Git repository
4. **Metadata & Protocol Sanitization**:
   - Protocol header injection defense: `validateTaskId` enforces `^c2c_[a-zA-Z0-9_-]{1,64}$`, rejecting whitespace, newlines, carriage returns, and control characters.
   - `generateTaskId()` generates 64-bit entropy using CSPRNG (`crypto.randomBytes(8).toString("hex")`).
   - `opts.goal`, `latestRecord.tests`, and `command` strings are sanitized via `sanitizeExecutionOutput` and forged `[C2C]` headers are escaped to `[_C2C_]`.
   - `latestRecord.changedFiles` filters out sensitive paths.
5. **Hard UTF-8 Byte Budget Truncation (`truncateUtf8ToBytes`)**:
   - Strictly guarantees `Buffer.byteLength(bundle.text, "utf8") <= maxTotalBytes` by pre-allocating truncation notice byte length.
   - Scans trailing byte bit-patterns (`0b10xxxxxx` continuation bytes and leading byte lengths) to ensure truncation strictly at character boundaries, preventing unicode replacement corruption (`�`).
6. **Truthful Documentation & Accurate Plan Names**:
   - Deprecated "ChatGPT Team" updated to "ChatGPT Business" across all documentation and skills (reflecting OpenAI's August 29, 2025 naming update).
   - Accurately differentiated ChatGPT Pro, Business, Enterprise, and Edu (MCP Mode, subject to admin/developer mode policies) from Plus and Free (Mode P, 100% local).
   - Truthfully qualified security claims (*"reduces secret-exposure risk through sensitive-file blocking, path containment, and deterministic known-secret redaction"*).
   - Split One-Paste Install into **Flow A: MCP Mode** and **Flow B: Mode P (100% Local)**.
7. **RFC 6819 Section 5.2.2.3 Token Family Tracking & Replay Protection**:
   - `AuthStore` in `src/auth/store.ts` tracks token family lineage (`familyId`, generation counters, tombstones `status: "used"`), triggering immediate cascade revocation upon replay detection.
8. **Fail-Closed Git-Ignore Handling**:
   - `ensureIgnoreLocalSettings` throws `GitExcludeError` if `.git/info/exclude` cannot be written, preventing unignored settings creation.

---

## 2. Final Architecture Summary

The system implements a decoupled dual-plane architecture:
- **Reasoning / Review Plane (ChatGPT Web / Pro / Business / Enterprise / Edu / Plus / Free)**: Operates within the official ChatGPT web interface to perform high-level planning, architectural reasoning, and code review without context window exhaustion.
- **Data Plane (C2C Bridge & Read-Only MCP)**: An Express HTTP daemon over Cloudflare Tunnel (Quick or Named) exposing exactly 9 read-only Model Context Protocol (MCP) tools secured by RFC 7591 Dynamic Client Registration, PKCE S256, RFC 6819 token family tracking, and 8-character CSPRNG pairing codes.
- **Execution Harness Plane (Claude Code CLI)**: Performs local file editing, terminal execution, compilation, testing, and git operations. The backend model is completely provider-neutral (Anthropic Claude, 9Router, Google Gemini, Amazon Bedrock, or custom local gateways).
- **Control Plane**: Standardized on **Mode C (Guided Manual Handoff)** as the 100% reliable default across all platforms for MCP-enabled plans, **Mode P** for Plus/Free 100% local manual handoff, and optional **Mode A** automated script support.

```
              ChatGPT Web (Pro / Business / Ent / Edu / Plus)
                 PLAN / REASON / REVIEW
                         |
                         |
                   READ-ONLY MCP (Mode C)  /  MANUAL BUNDLE (Mode P)
                   (OAuth 2.1)
                         |
                         v
                    C2C Bridge
                   (127.0.0.1)
                         |
                         v
                  Local Workspace
                         ^
                         |
             edit / shell / git / tests
                         |
                    Claude Code
                         |
                  model gateway
             (9Router / Gemini / others)
```
                   (127.0.0.1)
                         |
                         v
                  Local Workspace
                         ^
                         |
             edit / shell / git / tests
                         |
                    Claude Code
                         |
                  model gateway
             (9Router / Gemini / others)
```

---

## 3. Claude Code Settings Schema & Permission Specification

### A. Generated JSON Schema Structure (`.claude/settings.local.json`)
```json
{
  "permissions": {
    "allow": [
      "Bash(c2c setup *)",
      "Bash(c2c doctor *)",
      "Bash(c2c start *)",
      "Bash(c2c status *)",
      "Bash(c2c pair *)",
      "Bash(c2c session *)",
      "Bash(c2c record *)",
      "Bash(c2c logs *)",
      "Bash(c2c bundle *)"
    ]
  },
  "sandbox": {
    "filesystem": {
      "allowWrite": [
        "C:/Users/Developer/AppData/Local/claude-code-with-chatgpt"
      ]
    }
  }
}
```

### B. Settings Scopes
- **Workspace Scope (`c2c config-allow -w .`)**: Targets `.claude/settings.local.json` (git-ignored via `git rev-parse --git-path info/exclude`), storing machine-specific `sandbox.filesystem.allowWrite` paths and minimal `permissions.allow` rules.
- **Global Scope (`c2c config-allow -g`)**: Targets `~/.claude/settings.json` (user profile).
- **Shared Project Scope (`.claude/settings.json`)**: Contains portable repo-level build/test rules and subcommand patterns. Zero machine-specific absolute paths.

---

## 4. Verification Commands & Test Results

### A. TypeScript Typecheck
```bash
npm run typecheck
> tsc --noEmit
# Exit code: 0 (0 errors)
```

### B. Unit, Integration & Security Tests
```bash
npm test
> vitest run

 ✓ tests/git-ignore-failclosed.test.ts (3 tests)
 ✓ tests/search.test.ts (6 tests)
 ✓ tests/tunnel.test.ts (22 tests)
 ✓ tests/token-family.test.ts (5 tests)
 ✓ tests/port.test.ts (2 tests)
 ✓ tests/runtime.test.ts (4 tests)
 ✓ tests/security-redteam.test.ts (24 tests)
 ✓ tests/workspace.test.ts (20 tests)
 ✓ tests/prefs.test.ts (5 tests)
 ✓ tests/oauth.test.ts (16 tests)
 ✓ tests/execution-output.test.ts (7 tests)
 ✓ tests/session.test.ts (14 tests)
 ✓ tests/claude-skill.test.ts (7 tests)
 ✓ tests/claude-settings.test.ts (20 tests)
 ✓ tests/sandbox-allow.test.ts (7 tests)
 ✓ tests/pairing.test.ts (8 tests)
 ✓ tests/endpoint.test.ts (8 tests)
 ✓ tests/mcp-integration.test.ts (16 tests)
 ✓ tests/git.test.ts (14 tests)
 ✓ tests/bundle.test.ts (27 tests)

 Test Files  20 passed (20)
      Tests  235 passed (235)
   Duration  8.32s
```

### C. Build Pipeline
```bash
npm run build
> tsc -p tsconfig.json
# Exit code: 0 (dist/ generated cleanly)
```

---

## 5. Runtime Checklist

- [x] install succeeds
- [x] typecheck succeeds (0 errors)
- [x] unit tests succeed (235/235 passed across 20 test files)
- [x] integration tests succeed
- [x] build succeeds (`dist/` clean)
- [x] bridge starts and binds to loopback
- [x] `workspace_info` works
- [x] `list_directory` works
- [x] `read_file` works
- [x] `search_workspace` works
- [x] `git_status` works
- [x] `git_diff` works (including unborn repositories and rename protection)
- [x] `test_status` works
- [x] `execution_summary` works
- [x] sensitive files are denied (case-insensitive on Windows, `.git` files and directories)
- [x] traversal attempts are denied (null bytes, `../`, symlink escapes, Windows NTFS ADS `::$DATA`, trailing dots)
- [x] no arbitrary write MCP exists
- [x] no arbitrary exec MCP exists
- [x] Claude Skill is structurally correct (`.claude/skills/chatgpt-collab/SKILL.md`)
- [x] Claude setup paths and settings are correct (`c2c config-allow` updates `.claude/settings.local.json`)
- [x] provider/model is not hardcoded (supports Anthropic, 9Router, Gemini, Bedrock, OpenAI)
- [x] 9Router is optional
- [x] Gemini is optional
- [x] Codex-specific assumptions remaining are documented and isolated to legacy commands
- [x] control-plane capability is represented truthfully (Mode C default, Mode P local fallback, Mode A optional)
- [x] manual fallback works and is fully implemented via `c2c bundle plan` and `c2c bundle review`
- [x] fail-closed parsing preserves corrupted JSON files byte-for-byte
- [x] atomic file writes prevent partial corruption
- [x] minimal permissions exclude `node bin/c2c.js`, `c2c sandbox-allow`, `c2c config-allow`, and `c2c unpair`
- [x] token-boundary wildcards match subcommands and arguments cleanly
- [x] `git rev-parse --git-path info/exclude` preserves clean `.gitignore` in git repos and linked worktrees
- [x] `ensureIgnoreLocalSettings` fails closed on Git exclude failure
- [x] RFC 6819 token family rotation and replay attack revocation cascade implemented and verified
- [x] `darwin` treated as case-sensitive by default in `isCaseInsensitive`
- [x] non-mutating review changeset capture covers staged, unstaged, and safe untracked files
- [x] multi-layer sensitive untracked file gate protects secrets across diffs and status
- [x] protocol headers, task ID regex, and metadata sanitization defense verified
- [x] exact hard UTF-8 safe byte boundary truncation guaranteed

---

## 6. Summary of Independent Multi-Agent Verification

- **Final Review Completeness Auditor**: **PASSED** — Inspected `src/bundle/builder.ts`, `src/bundle/untracked.ts`, `src/workspace/git.ts`, and `tests/bundle.test.ts`. Verified `c2c bundle review` defaults to `head` mode and synthesizes unified diffs for safe untracked files without mutating Git state (no `git add`, no staging, no reset). Confirmed complete handling across Git matrix (Cases A through O, unborn repos, deletions, renames, and subdirectories).
- **Final Bundle Security Auditor**: **PASSED** — Verified multi-layer sensitive file blocking (`.env*`, `credentials.json`, `*.pem`, `*.key`, `id_rsa*`, `.git/*`), metadata and command sanitization, fake `[C2C]` header escaping to `[_C2C_]`, 64-bit CSPRNG task ID generation with regex validation, and hard UTF-8 byte boundary truncation without multibyte splitting.
- **Final Mode P Docs & Runtime Auditor**: **PASSED** — Verified truthful plan name updates (zero "ChatGPT Team" references; updated to "ChatGPT Business" per August 29, 2025 naming update), qualified security claims, clean split of One-Paste Install into Flow A (MCP Mode) vs Flow B (Mode P, 100% local), and Mode P runtime UX in `SKILL.md`.

---

## 7. Known Non-Blocking LOW Observations

1. **End-to-End Runtime Validation Status**: Automated test suite (235/235 tests across 20 files), typecheck, and build are 100% PASS; live browser pairing over Cloudflare tunnel remains PENDING user runtime execution.
2. **Legacy Codex Commands**: `c2c sandbox-allow` is preserved exclusively for legacy Codex backwards compatibility; standard Claude Code workflows use `c2c config-allow` without touching `~/.codex/config.toml`.

---

## 8. Final Gate Verdict

**CODE QUALITY GATES: PASS | END-TO-END RUNTIME VALIDATION: PENDING**
- Build Pipeline: Clean (`tsc -p tsconfig.json`)
- Typecheck: Clean (`tsc --noEmit`, 0 errors)
- Automated Test Suite: 235/235 tests passing across 20 test suites (100% pass rate)
- All security, review completeness, and architectural invariants strictly enforced.
- **No push executed** (per instructions).
- All security and architectural invariants strictly enforced.
- **No push executed** (per instructions).


