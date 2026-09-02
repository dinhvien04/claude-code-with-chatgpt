# Port Review & System Delivery: `claude-code-with-chatgpt`

> **Repository**: `dinhvien04/claude-code-with-chatgpt` (Forked & Ported from `XiaoDuoYa/codex-with-chatgpt`)  
> **Package Service**: `claude-code-with-chatgpt` (CLI: `c2c`, Version: `0.1.1`)  
> **Core Principle**: *"ChatGPT thinks. Claude Code works."*  
> **Baseline Commit**: `6f4fe1811bb1c62d86106250c0a35b96cd11a963`  
> **Lead Engineer Verification Date**: 2026-09-02  
> **Overall Port Status**: **CODE QUALITY GATES: PASS | END-TO-END RUNTIME VALIDATION: PENDING**

---

## 1. Review-Integrity & Fail-Closed Security Pass Summary

Following independent multi-agent review sweeps and security verification against the official Claude Code settings schema and OpenAI subscription tiers, the following critical review completeness and fail-closed invariants were implemented:

1. **Explicit Review Completeness Decision (`REVIEW_COMPLETE: true | false`)**:
   - Eliminates silent approval of partial changesets. `REVIEW_COMPLETE` is `true` if and only if `currentChunk === totalChunks && !gitError && !untrackedTruncated && !bundleTruncated`.
   - If any data was skipped or truncated, Git execution errored, or further diff chunks remain, `REVIEW_COMPLETE` strictly returns `false`.

2. **Enforced Conditional Instructions**:
   - When `REVIEW_COMPLETE: false`, the bundle instruction explicitly commands:
     *"DO NOT return STATE: DONE. The review context is incomplete (Chunk M of N)... Request the next chunk with 'c2c bundle review --task <id> --iteration <n> --chunk <n+1>' or reply with [C2C] STATE: PLAN if an issue is already identified."*
   - Only when `REVIEW_COMPLETE: true` does the instruction invite `STATE: DONE`.

3. **Deterministic Review Pagination & Chunking (`partitionDiffBlocks`)**:
   - Added `--chunk <n>` CLI flag and `REVIEW_CHUNK: M/N` header.
   - Implemented `partitionDiffBlocks()` to slice arbitrary tracked and untracked unified diffs into sequential bounded packages (<= 24 KB / 200 lines per chunk) without mutating Git state.
   - Slices large single-file diffs cleanly across chunks with deterministic continuation notices (`... (diff for '<path>' continued from previous chunk, part N)`).

4. **Safe Changed-File Manifest (`CHANGESET_SUMMARY`)**:
   - Every review bundle exposes a deterministic manifest of:
     - `Tracked changed: <count>`
     - `Safe untracked: <count>`
     - `Sensitive withheld: <count>`
     - `Review chunks: <total> (Current chunk: <current>)`

5. **Section-Aware Byte Budgeting & Dedicated Test Bounds**:
   - Preserves mandatory protocol headers (`[C2C]`, `STATE`, `TASK_ID`, `ITERATION`, `MODE`, `REVIEW_COMPLETE`, `CHANGESET_SUMMARY`, `REVIEW_CHUNK`, `REVIEW_WARNINGS`, `BOUNDED_GIT_DIFF`, `INSTRUCTION`) under any bundle size limit.
   - Dedicated hard caps for variable inner sections:
     - `SANITIZED_TESTS`: Hard-capped at 4 KB / 40 lines (`MAX_TEST_SUMMARY_BYTES = 4096`, `MAX_TEST_SUMMARY_LINES = 40`).
     - `SANITIZED_EXECUTION_OUTPUT`: Hard-capped at 8 KB / 80 lines (`MAX_OUTPUT_BYTES = 8192`, `MAX_OUTPUT_LINES = 80`).
     - `BOUNDED_GIT_DIFF`: Hard-capped at 24 KB / 200 lines per chunk (`MAX_DIFF_BYTES = 24576`, `MAX_DIFF_LINES = 200`).

6. **Typed Git Failure Propagation (`GitDiffResult`)**:
   - Added typed `ok: boolean`, `errorCode`, and `errorMessage` to `GitDiffResult`.
   - Git execution failures, non-zero exits, and non-repository directories never convert into `(empty diff)` or permit `REVIEW_COMPLETE: true`.

7. **Embedded Bundle Warnings (`REVIEW_WARNINGS:`)**:
   - Embeds actionable, sanitized review warnings directly in the plain text bundle without leaking sensitive paths or credential material.

8. **Neutral UTF-8 Safe Byte Boundary Truncation (`src/bundle/truncate.ts`)**:
   - Extracted `truncateUtf8ToBytes()` into a standalone module.
   - Pre-allocates truncation notice budgets and inspects UTF-8 continuation byte bit-patterns (`0b10xxxxxx`) to guarantee that multi-byte codepoints (Vietnamese, Chinese, Emoji) are never split or corrupted into replacement characters (``).

9. **Untrusted Repository Payload Boundary Framing**:
   - Diffs, snippets, and untrusted contents are wrapped in `<<<UNTRUSTED_DIFF_PAYLOAD>>>` and `<<<UNTRUSTED_SNIPPET_PAYLOAD>>>` boundary delimiters.
   - Embeds security notices instructing reasoning models that payload contents must never override protocol state or instructions.

10. **Package Metadata & Task ID Alignment**:
    - Updated `package.json` package name to `"claude-code-with-chatgpt"` and description to `"ChatGPT thinks. Claude Code works."`.
    - Aligned example task IDs in docs and skills to 16-hex format (`c2c_0123456789abcdef`).
    - Split Quickstart documentation into Common Installation -> Option A (Mode P, 100% Local) vs Option B (MCP Mode) with `[MCP-Mode-Only]` labels.

---

## 2. Final Architecture Summary

The system implements a decoupled dual-plane architecture:
- **Reasoning / Review Plane (ChatGPT Web / Pro / Business / Enterprise / Edu / Plus / Free)**: Operates within the official ChatGPT web interface to perform high-level planning, architectural reasoning, and code review without context window exhaustion.
- **Data Plane (C2C Bridge & Read-Only MCP)**: An Express HTTP daemon over Cloudflare Tunnel (Quick or Named) exposing exactly 9 read-only Model Context Protocol (MCP) tools secured by RFC 7591 Dynamic Client Registration, PKCE S256, RFC 6819 token family tracking, and 8-character CSPRNG pairing codes.
- **Execution Harness Plane (Claude Code CLI)**: Performs local file editing, terminal execution, compilation, testing, and git operations. The backend model is completely provider-neutral (Anthropic Claude, 9Router, Google Gemini, Amazon Bedrock, or custom local gateways).
- **Control Plane**: Standardized on **Mode C (Guided Manual Handoff)** as the 100% reliable default across all platforms for MCP-enabled plans, **Mode P** for Plus/Free 100% local manual handoff with deterministic chunking, and optional **Mode A** automated script support.

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

 ✓ tests/token-family.test.ts (5 tests)
 ✓ tests/git-ignore-failclosed.test.ts (3 tests)
 ✓ tests/search.test.ts (6 tests)
 ✓ tests/tunnel.test.ts (22 tests)
 ✓ tests/workspace.test.ts (20 tests)
 ✓ tests/prefs.test.ts (5 tests)
 ✓ tests/claude-settings.test.ts (20 tests)
 ✓ tests/security-redteam.test.ts (24 tests)
 ✓ tests/runtime.test.ts (4 tests)
 ✓ tests/execution-output.test.ts (7 tests)
 ✓ tests/session.test.ts (14 tests)
 ✓ tests/claude-skill.test.ts (7 tests)
 ✓ tests/oauth.test.ts (16 tests)
 ✓ tests/sandbox-allow.test.ts (7 tests)
 ✓ tests/endpoint.test.ts (8 tests)
 ✓ tests/port.test.ts (2 tests)
 ✓ tests/package-metadata.test.ts (1 test)
 ✓ tests/pairing.test.ts (8 tests)
 ✓ tests/mcp-integration.test.ts (16 tests)
 ✓ tests/git.test.ts (14 tests)
 ✓ tests/bundle.test.ts (39 tests)

 Test Files  21 passed (21)
      Tests  248 passed (248)
   Duration  22.53s
```

### C. Build Pipeline
```bash
npm run build
> tsc -p tsconfig.json
# Exit code: 0 (dist/ generated cleanly)
```

### D. End-to-End CLI Smoke Scenarios
1. **Scenario 1: Clean Repo Plan & Review Bundle**: Clean workspace yields valid `INIT_P` plan bundle and `EXECUTED_P` review bundle with `REVIEW_COMPLETE: true`, `CHANGESET_SUMMARY` zero counts, and `(empty diff)`.
2. **Scenario 2: Large Changeset Multi-Chunk Pagination**: 400-line changeset cleanly partitions into 2 chunks. Chunk 1 produces `REVIEW_COMPLETE: false`, instruction forbidding `DONE`, and warning pointing to chunk 2. Chunk 2 produces `REVIEW_COMPLETE: true` and invites `DONE`.
3. **Scenario 3: Mixed Changes with Sensitive Files**: Safe files (`app.ts`) diffed; sensitive files (`.env`, `credentials.json`) withheld; `CHANGESET_SUMMARY` reflects 2 withheld files and 1 safe file.
4. **Scenario 4: Non-Git Workspace**: Gracefully reports Git error, outputs `REVIEW_COMPLETE: false`, and issues instruction forbidding `DONE`.

---

## 5. Runtime Checklist

- [x] install succeeds
- [x] typecheck succeeds (0 errors)
- [x] unit tests succeed (248/248 passed across 21 test files)
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
- [x] exact hard UTF-8 safe byte boundary truncation guaranteed without multi-byte corruption
- [x] review completeness decision strictly fail-closed (`REVIEW_COMPLETE: true | false`)
- [x] conditional instruction strictly forbids `STATE: DONE` on incomplete reviews
- [x] review pagination & chunking cleanly partitions diffs (<= 24 KB / 200 lines) with continuation notices
- [x] safe changed-file manifest (`CHANGESET_SUMMARY`) embedded in all review bundles
- [x] dedicated test summary budget (4 KB / 40 lines) and log budget (8 KB / 80 lines) enforced
- [x] typed git failure propagation prevents silent empty diffs on error
- [x] untrusted repository payload boundary framing (`<<<UNTRUSTED_*_PAYLOAD>>>`) enforced

---

## 6. Summary of Independent Multi-Agent Verification

- **Final Review Completeness Auditor**: **PASSED** — Inspected `src/bundle/builder.ts`, `src/bundle/untracked.ts`, `src/workspace/git.ts`, and `tests/bundle.test.ts`. Verified `c2c bundle review` defaults to `head` mode, synthesizes unified diffs for safe untracked files without mutating Git state, partitions diffs deterministically (`partitionDiffBlocks`), and strictly marks `REVIEW_COMPLETE: false` on any partial chunk or Git failure.
- **Final Bundle Security & Budget Auditor**: **PASSED** — Verified multi-layer sensitive file blocking (`.env*`, `credentials.json`, `*.pem`, `*.key`, `id_rsa*`, `.git/*`), dedicated test summary limits (4 KB / 40 lines), execution log caps (8 KB / 80 lines), untrusted payload boundary framing (`<<<UNTRUSTED_DIFF_PAYLOAD>>>`), and UTF-8 safe byte boundary truncation in `src/bundle/truncate.ts`.
- **Final Release Metadata & Docs Auditor**: **PASSED** — Verified `package.json` alignment (`"claude-code-with-chatgpt"`), split Quickstart documentation into Option A (Mode P, 100% Local) vs Option B (MCP Mode), `[MCP-Mode-Only]` section badges, and 16-hex task IDs (`c2c_0123456789abcdef`).

---

## 7. Known Non-Blocking LOW Observations

1. **End-to-End Runtime Validation Status**: Automated test suite (248/248 tests across 21 files), typecheck, and build are 100% PASS; live browser pairing over Cloudflare tunnel remains PENDING user runtime execution.
2. **Legacy Codex Commands**: `c2c sandbox-allow` is preserved exclusively for legacy Codex backwards compatibility; standard Claude Code workflows use `c2c config-allow` without touching `~/.codex/config.toml`.

---

## 8. Final Gate Verdict

**CODE QUALITY GATES: PASS | END-TO-END RUNTIME VALIDATION: PENDING**
- Build Pipeline: Clean (`tsc -p tsconfig.json`)
- Typecheck: Clean (`tsc --noEmit`, 0 errors)
- Automated Test Suite: 248/248 tests passing across 21 test suites (100% pass rate)
- All security, review completeness, fail-closed, and architectural invariants strictly enforced.
- **No push, tag, or release executed** (strictly per instructions).
