# Final Review Findings & Resolution Matrix

> **Synthesis Date**: 2026-09-01  
> **Review Agents Participating**: `architecture-reviewer`, `security-reviewer`, `protocol-reviewer`, `adversarial-test-reviewer`, `simplicity-reviewer`  
> **Status**: Evidence-Based Consensus & Prioritized Fix Directives

---

## 1. Finding Classification Matrix

| Finding ID | Source Reviewer | Description | Severity | Classification | Action Plan |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **DEF-01** | `adversarial-test-reviewer` | `HARD_REJECT` regexes in `src/execution/sanitize.ts` lack `/i` flag for case-insensitive PEM headers | **HIGH** | **CONFIRMED** | Add `/i` flag to all `HARD_REJECT` regular expressions and add test coverage. |
| **DEF-02** | `adversarial-test-reviewer` | `.git` file in git worktrees/submodules bypassed directory-only `.git/` pattern | **HIGH** | **CONFIRMED** | Add `".git"` alongside `".git/"` and `".git/**"` in `SENSITIVE_PATTERNS` (`src/workspace/ignore.ts`). |
| **DEF-03** | `adversarial-test-reviewer` | Non-C drive and forward-slash home paths in `src/execution/sanitize.ts` (`D:\Users\...`, `C:/Users/...`) | **MEDIUM** | **CONFIRMED** | Update `redactHomePaths` to match `/[a-zA-Z]:[/\\]Users[/\\][^/\\\s"'`]+/gi` and generic POSIX/Windows patterns. |
| **DEF-04** | `adversarial-test-reviewer` | Unborn git repositories (0 commits) report `isRepo: false` during `git diff HEAD` | **MEDIUM** | **CONFIRMED** | Catch revision parsing errors in `src/workspace/git.ts` and return empty diff with `isRepo: true`. |
| **DEF-05** | `adversarial-test-reviewer` | Trailing torn/corrupted lines in `executions/*.jsonl` can cause `latestExecutionRecord` to return `null` | **MEDIUM** | **CONFIRMED** | Parse JSONL lines in reverse and skip invalid/empty trailing fragments gracefully. |
| **DEF-06** | `adversarial-test-reviewer` | Admin bearer token check in `src/bridge/server.ts` uses non-constant-time equality | **MEDIUM** | **CONFIRMED** | Use `crypto.timingSafeEqual` with buffer padding for secure constant-time verification. |
| **DEF-07** | `simplicity-reviewer` | Ghost tool `file_outline` listed in prompt template in `.claude/skills/chatgpt-collab/SKILL.md` | **MEDIUM** | **CONFIRMED** | Remove `file_outline` from the boot prompt template to match the exact 9 MCP tools. |
| **DEF-08** | `architecture-reviewer` | Dead code: unused functions (`ensureClaudeSettings`, `stateSubdir`, `deleteStateFile`) and redundant tunnel methods | **LOW** | **CONFIRMED** | Clean up unused exports and methods in `src/config/`, `src/auth/`, and `src/tunnel/`. |
| **DEF-09** | `architecture-reviewer` | Rebranding consistency in `src/config/paths.ts` and `src/version.ts` with backward compatibility | **LOW** | **CONFIRMED** | Allow `C2C_STATE_DIR` / legacy path fallback while modernizing service and product names. |
| **DEF-10** | `security-reviewer` | RFC 6819 Refresh token family reuse revocation | **LOW** | **CONFIRMED** | Retain for future release; current rotation and SHA-256 storage exceeds standard security requirements. |
| **DEF-11** | `security-reviewer` | Unbounded `pendingRequests` Map under high-frequency unauthenticated load | **LOW** | **CONFIRMED** | Add max size cap (1000 items) and periodic cleanup to `pendingRequests` in `src/auth/oauth.ts`. |
| **DEF-12** | `adversarial-test-reviewer` | False positive on POSIX filenames ending with dot | **LOW** | **FALSE POSITIVE** | NTFS/Windows file system normalizes dots; defensive rejection on Windows avoids severe ADS/leak vulnerabilities. |

---

## 2. Phase G Fix Directives & Assignments

All CONFIRMED issues of HIGH and MEDIUM severity (DEF-01 through DEF-07) plus code hygiene items (DEF-08, DEF-09, DEF-11) will be resolved by the fix team:

1. **`bridge-implementer`**:
   - `src/execution/sanitize.ts`: Add `/i` flag to `HARD_REJECT` regexes; improve `redactHomePaths` for drive letters and forward slashes.
   - `src/workspace/ignore.ts`: Add `".git"` to `SENSITIVE_PATTERNS`.
   - `src/workspace/git.ts`: Handle unborn HEAD cleanly in `gitDiff`.
   - `src/execution/records.ts`: Tolerate trailing torn JSONL lines.
   - `src/bridge/server.ts`: Implement `crypto.timingSafeEqual` in `adminGuard`.
   - `src/auth/oauth.ts`: Bound `pendingRequests` Map.
   - `src/config/sandbox-allow.ts`, `src/config/paths.ts`, `src/auth/store.ts`, `src/tunnel/provider.ts`: Clean up dead code.

2. **`claude-integration-implementer`**:
   - `.claude/skills/chatgpt-collab/SKILL.md`: Remove `file_outline` from prompt templates.

3. **`test-implementer`**:
   - Add regression test cases in `tests/security-redteam.test.ts`, `tests/git.test.ts`, `tests/execution-output.test.ts`, and `tests/claude-skill.test.ts`.
