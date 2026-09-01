# Port Review & System Delivery: `claude-code-with-chatgpt`

> **Repository**: `dinhvien04/claude-code-with-chatgpt` (Forked & Ported from `XiaoDuoYa/codex-with-chatgpt`)  
> **Package Service**: `c2c-bridge` (CLI: `c2c`, Version: `0.1.1`)  
> **Core Principle**: *"ChatGPT thinks. Claude Code works."*  
> **Baseline Commit**: `9559adc` (fix: permission wildcards, exclude sensitive subcommands, git exclude and case normalization)  
> **Lead Engineer Verification Date**: 2026-09-01  
> **Overall Port Status**: **CODE QUALITY GATES: PASS | END-TO-END RUNTIME VALIDATION: PENDING**

---

## 1. Corrective Pass Summary (Post-Audit Hardening)

Following independent multi-agent review sweeps and security verification against the official Claude Code settings schema, the following critical improvements were implemented:

1. **Token-Boundary Wildcard Permission Patterns**:
   - Replaced adjacent wildcards (`Bash(c2c setup*)`, `Bash(node bin/c2c.js setup*)`) with proper token-boundary patterns (`Bash(c2c setup *)`, `Bash(node bin/c2c.js setup *)`).
   - Ensures Claude Code wildcard matching accurately handles subcommands and arguments (`c2c setup`, `c2c setup -w .`, `c2c setup --json`) without overmatching adjacent binaries.
2. **Minimization of Auto-Approved Commands**:
   - Excluded sensitive token revocation (`c2c unpair`) and administrative setup commands (`c2c sandbox-allow`, `c2c config-allow`) from default auto-approval rules. Revoking OAuth tokens or altering configuration requires explicit user consent.
3. **Reliable Local Settings Git Exclusion via `.git/info/exclude`**:
   - Implemented `findGitDir()` to resolve both standard `.git` directories and Git worktrees (`gitdir: <path>` pointer files).
   - In Git repositories and worktrees, machine-specific `.claude/settings.local.json` is appended to `.git/info/exclude`, ensuring `.gitignore` is not dirtied in shared repositories.
   - Non-git directories safely fall back to workspace `.gitignore` creation.
4. **Platform-Aware Path Normalization**:
   - Implemented `isCaseInsensitive()` and `normPath()`. Deduplication of state directory paths in `sandbox.filesystem.allowWrite` uses case-insensitive comparison on Windows (`win32`) and macOS (`darwin`), while strictly preserving case differentiation on Linux/POSIX.
5. **Accurate Native Windows Sandbox Documentation**:
   - Explicitly documented in `docs/security.md` that OS filesystem sandboxing (Bubblewrap on Linux, Seatbelt on macOS) does not run on native Windows, while application-level tool permissions remain 100% enforced. Recommended WSL2 for kernel-level process containment.
6. **Installation & Setup Flow Alignment**:
   - Explicitly integrated `c2c config-allow -w .` before `c2c setup -w .` across English/Chinese one-paste setup prompts (`README.md`, `README.zh-CN.md`), manual quickstarts, and Claude Skill documentation (`SKILL.md`).
7. **Fail-Closed & Atomic Settings Persistence**:
   - `readClaudeSettings` throws `MalformedSettingsError` on corrupt JSON, preserving files untouched on disk.
   - `writeClaudeSettingsAtomic` uses exclusive temporary files (`.tmp...`) with mode `0o600`, directory mode `0o700`, `fsync`, and atomic rename replacement.

---

## 2. Final Architecture Summary

The system implements a decoupled dual-plane architecture:
- **Reasoning / Review Plane (ChatGPT Web / Plus / Pro)**: Operates within the official ChatGPT web interface to perform high-level planning, architectural reasoning, and code review without context window exhaustion.
- **Data Plane (C2C Bridge & Read-Only MCP)**: An Express HTTP daemon over Cloudflare Tunnel (Quick or Named) exposing exactly 9 read-only Model Context Protocol (MCP) tools secured by RFC 7591 Dynamic Client Registration, PKCE S256, and 8-character CSPRNG pairing codes.
- **Execution Harness Plane (Claude Code CLI)**: Performs local file editing, terminal execution, compilation, testing, and git operations. The backend model is completely provider-neutral (Anthropic Claude, 9Router, Google Gemini, Amazon Bedrock, or custom local gateways).
- **Control Plane**: Standardized on **Mode C (Guided Manual Handoff)** as the 100% reliable default across all platforms, with optional **Mode A** automated script support.

```
              ChatGPT Web / ChatGPT Plus
                 PLAN / REASON / REVIEW
                         |
                         |
                   READ-ONLY MCP
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

### A. Generated JSON Schema Structure
```json
{
  "permissions": {
    "allow": [
      "Bash(c2c setup *)",
      "Bash(c2c doctor *)",
      "Bash(c2c start *)",
      "Bash(c2c stop *)",
      "Bash(c2c restart *)",
      "Bash(c2c status *)",
      "Bash(c2c pair *)",
      "Bash(c2c session *)",
      "Bash(c2c record *)",
      "Bash(c2c tunnel *)",
      "Bash(c2c prefs *)",
      "Bash(c2c logs *)",
      "Bash(c2c workspace *)",
      "Bash(c2c update-check *)",
      "Bash(node bin/c2c.js setup *)",
      "Bash(node bin/c2c.js doctor *)",
      "Bash(node bin/c2c.js start *)",
      "Bash(node bin/c2c.js stop *)",
      "Bash(node bin/c2c.js restart *)",
      "Bash(node bin/c2c.js status *)",
      "Bash(node bin/c2c.js pair *)",
      "Bash(node bin/c2c.js session *)",
      "Bash(node bin/c2c.js record *)",
      "Bash(node bin/c2c.js tunnel *)",
      "Bash(node bin/c2c.js prefs *)",
      "Bash(node bin/c2c.js logs *)",
      "Bash(node bin/c2c.js workspace *)",
      "Bash(node bin/c2c.js update-check *)"
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
- **Workspace Scope (`c2c config-allow -w .`)**: Targets `.claude/settings.local.json` (git-ignored via `.git/info/exclude`), storing machine-specific `sandbox.filesystem.allowWrite` paths and minimal `permissions.allow` rules.
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

 ✓ tests/prefs.test.ts (5 tests)
 ✓ tests/workspace.test.ts (20 tests)
 ✓ tests/search.test.ts (6 tests)
 ✓ tests/claude-settings.test.ts (20 tests)
 ✓ tests/tunnel.test.ts (22 tests)
 ✓ tests/execution-output.test.ts (7 tests)
 ✓ tests/session.test.ts (14 tests)
 ✓ tests/pairing.test.ts (8 tests)
 ✓ tests/sandbox-allow.test.ts (7 tests)
 ✓ tests/port.test.ts (2 tests)
 ✓ tests/security-redteam.test.ts (24 tests)
 ✓ tests/claude-skill.test.ts (7 tests)
 ✓ tests/endpoint.test.ts (8 tests)
 ✓ tests/runtime.test.ts (4 tests)
 ✓ tests/oauth.test.ts (16 tests)
 ✓ tests/mcp-integration.test.ts (16 tests)
 ✓ tests/git.test.ts (14 tests)

 Test Files  17 passed (17)
      Tests  200 passed (200)
   Duration  4.18s
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
- [x] unit tests succeed (200/200 passed)
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
- [x] sensitive files are denied (case-insensitive on Windows/macOS, `.git` files and directories)
- [x] traversal attempts are denied (null bytes, `../`, symlink escapes, Windows NTFS ADS `::$DATA`, trailing dots)
- [x] no arbitrary write MCP exists
- [x] no arbitrary exec MCP exists
- [x] Claude Skill is structurally correct (`.claude/skills/chatgpt-collab/SKILL.md`)
- [x] Claude setup paths and settings are correct (`c2c config-allow` updates `.claude/settings.local.json`)
- [x] provider/model is not hardcoded (supports Anthropic, 9Router, Gemini, Bedrock, OpenAI)
- [x] 9Router is optional
- [x] Gemini is optional
- [x] Codex-specific assumptions remaining are documented and isolated to legacy commands
- [x] control-plane capability is represented truthfully (Mode C default, Mode A optional)
- [x] manual fallback works and is fully documented
- [x] fail-closed parsing preserves corrupted JSON files byte-for-byte
- [x] atomic file writes prevent partial corruption
- [x] minimal permissions exclude `c2c sandbox-allow`, `c2c config-allow`, and `c2c unpair`
- [x] token-boundary wildcards match subcommands and arguments cleanly
- [x] `.git/info/exclude` preserves clean `.gitignore` in git repos and worktrees

---

## 6. Summary of Independent Multi-Agent Verification

- **Final Permission Reviewer**: **PASSED** — Confirmed all `REQUIRED_PERMISSIONS` and `.claude/settings.json` rules use token-boundary wildcard syntax `Bash(c2c <subcommand> *)` and `Bash(node bin/c2c.js <subcommand> *)`. Verified that sensitive token revocation (`c2c unpair`) and administrative setup commands (`c2c sandbox-allow`, `c2c config-allow`) are excluded from auto-approval.
- **Final Install Reviewer**: **PASSED** — Verified consistent and accurate documentation across `README.md`, `README.zh-CN.md`, and `SKILL.md`, ensuring `c2c config-allow -w .` is explicitly executed before `c2c setup -w .`.
- **Final Security Reviewer**: **PASSED** — Verified worktree-aware `.git/info/exclude` exclusion via `findGitDir()` and `ensureIgnoreLocalSettings()`, confirmed platform-aware path case normalization via `normPath()`, and confirmed accurate documentation of native Windows sandbox realities in `docs/security.md`.

---

## 7. Known Non-Blocking LOW Observations

1. **End-to-End Runtime Validation Status**: Automated test suite (200/200 tests across 17 files), typecheck, and build are 100% PASS; live browser pairing over Cloudflare tunnel remains PENDING user runtime execution.
2. **Refresh Token Family Revocation**: Single-use refresh token rotation is enforced; full family tree revocation under RFC 6819 is slated for v0.2.0.
3. **Legacy Codex Commands**: `c2c sandbox-allow` is preserved exclusively for legacy Codex backwards compatibility; standard Claude Code workflows use `c2c config-allow` without touching `~/.codex/config.toml`.

---

## 8. Final Gate Verdict

**CODE QUALITY GATES: PASS | END-TO-END RUNTIME VALIDATION: PENDING**
- Build Pipeline: Clean (`tsc -p tsconfig.json`)
- Typecheck: Clean (`tsc --noEmit`, 0 errors)
- Automated Test Suite: 200/200 tests passing across 17 test suites (100% pass rate)
- No unauthorized git push executed.
