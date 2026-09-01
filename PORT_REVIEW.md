# Port Review & System Delivery: `claude-code-with-chatgpt`

> **Repository**: `dinhvien04/claude-code-with-chatgpt` (Forked & Ported from `XiaoDuoYa/codex-with-chatgpt`)  
> **Package Service**: `c2c-bridge` (CLI: `c2c`, Version: `0.1.1`)  
> **Core Principle**: *"ChatGPT thinks. Claude Code works."*  
> **Baseline Commit**: `07fa44a` (fix: resolve audit discrepancies and decouple Claude Code settings)  
> **Lead Engineer Verification Date**: 2026-09-01  
> **Overall Port Status**: **COMPLETE & VERIFIED (ALL GATES PASS)**

---

## 1. Corrective Pass Summary (Post-Audit Hardening)

Following independent multi-agent review sweeps and security verification against the official Claude Code settings schema, the following critical improvements were implemented:

1. **Elimination of Invented `writableRoots` Key**:
   - Replaced all occurrences of the invented `writableRoots` key with the officially supported `sandbox.filesystem.allowWrite` property under the `sandbox` block.
   - Added automatic detection and cleanup of legacy `writableRoots` properties in pre-existing settings files.
2. **Machine-Specific Isolation via `.claude/settings.local.json`**:
   - `c2c config-allow` writes machine-specific absolute state directories (`%LOCALAPPDATA%\claude-code-with-chatgpt`, `~/Library/Application Support/claude-code-with-chatgpt`) to `.claude/settings.local.json` rather than the shared `.claude/settings.json`, preventing machine paths from being committed to Git.
   - Automatically ensures `.claude/settings.local.json` is added to `.gitignore`.
3. **Fail-Closed Malformed Settings Parsing**:
   - Implemented `readClaudeSettings` with strict error handling. If a settings file contains syntax errors or invalid non-object roots, a `MalformedSettingsError` is thrown immediately.
   - The file on disk is preserved byte-for-byte; corrupted user settings are never overwritten with blank defaults.
4. **Atomic Write Guarantee**:
   - Implemented `writeClaudeSettingsAtomic` utilizing exclusive temporary files (`.tmp...`) created in the same directory with mode `0o600`, directory mode `0o700`, `fs.fsyncSync`, and atomic rename replacement (`fs.renameSync`).
5. **Minimal Bash Permission Scoping**:
   - Replaced broad `Bash(c2c *)` wildcards with granular per-subcommand rules (`Bash(c2c setup*)`, `Bash(c2c doctor*)`, `Bash(c2c status*)`, `Bash(c2c pair*)`, `Bash(c2c session*)`, `Bash(c2c record*)`, etc.).
   - Explicitly excluded administrative and legacy commands (`c2c sandbox-allow`, `c2c config-allow`) from auto-approval.
6. **Strict Idempotency & Semantics Stability**:
   - Subsequent executions of `ensureClaudeConfigAllow` on already-configured settings files produce zero byte changes on disk and return `{ added: false, alreadyAllowed: true }`.

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
      "Bash(c2c setup*)",
      "Bash(c2c doctor*)",
      "Bash(c2c start*)",
      "Bash(c2c stop*)",
      "Bash(c2c restart*)",
      "Bash(c2c status*)",
      "Bash(c2c pair*)",
      "Bash(c2c unpair*)",
      "Bash(c2c session*)",
      "Bash(c2c record*)",
      "Bash(c2c tunnel*)",
      "Bash(c2c prefs*)",
      "Bash(c2c logs*)",
      "Bash(c2c workspace*)",
      "Bash(c2c update-check*)",
      "Bash(node bin/c2c.js setup*)",
      "Bash(node bin/c2c.js doctor*)",
      "Bash(node bin/c2c.js start*)",
      "Bash(node bin/c2c.js stop*)",
      "Bash(node bin/c2c.js restart*)",
      "Bash(node bin/c2c.js status*)",
      "Bash(node bin/c2c.js pair*)",
      "Bash(node bin/c2c.js unpair*)",
      "Bash(node bin/c2c.js session*)",
      "Bash(node bin/c2c.js record*)",
      "Bash(node bin/c2c.js tunnel*)",
      "Bash(node bin/c2c.js prefs*)",
      "Bash(node bin/c2c.js logs*)",
      "Bash(node bin/c2c.js workspace*)",
      "Bash(node bin/c2c.js update-check*)"
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
- **Workspace Scope (`c2c config-allow -w .`)**: Targets `.claude/settings.local.json` (git-ignored), storing machine-specific `sandbox.filesystem.allowWrite` paths and minimal `permissions.allow` rules.
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
 ✓ tests/claude-settings.test.ts (15 tests)
 ✓ tests/search.test.ts (6 tests)
 ✓ tests/session.test.ts (14 tests)
 ✓ tests/tunnel.test.ts (22 tests)
 ✓ tests/execution-output.test.ts (7 tests)
 ✓ tests/sandbox-allow.test.ts (7 tests)
 ✓ tests/pairing.test.ts (8 tests)
 ✓ tests/port.test.ts (2 tests)
 ✓ tests/runtime.test.ts (4 tests)
 ✓ tests/claude-skill.test.ts (7 tests)
 ✓ tests/endpoint.test.ts (8 tests)
 ✓ tests/security-redteam.test.ts (24 tests)
 ✓ tests/oauth.test.ts (16 tests)
 ✓ tests/mcp-integration.test.ts (16 tests)
 ✓ tests/git.test.ts (14 tests)

 Test Files  17 passed (17)
      Tests  195 passed (195)
   Duration  4.64s
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
- [x] unit tests succeed (195/195 passed)
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
- [x] minimal permissions exclude `c2c sandbox-allow` and `c2c config-allow`

---

## 6. Summary of Independent Multi-Agent Verification

- **Final Claude Config Reviewer**: **PASSED** — Verified official Claude Code JSON schema validity (`permissions.allow`, `sandbox.filesystem.allowWrite`), confirmed complete removal of invented `writableRoots`, verified local workspace scoping via `.claude/settings.local.json`, and confirmed `.gitignore` isolation.
- **Final Security Reviewer**: **PASSED** — Verified minimal scoped permissions (no broad wildcards, `sandbox-allow` excluded), confirmed read-only MCP invariant across all 9 tools, verified fail-closed `MalformedSettingsError`, and confirmed atomic temporary file write and replacement with mode `0o600`.
- **Final Regression Reviewer**: **PASSED** — Verified all 17 test suites (195 tests) passing cleanly, confirmed cross-platform path handling (Windows backslashes, spaces, Unicode NFC), verified isolation from `~/.codex/config.toml`, and verified documentation alignment.

---

## 7. Known Non-Blocking LOW Observations

1. **Refresh Token Family Revocation**: Single-use refresh token rotation is enforced; full family tree revocation under RFC 6819 is slated for v0.2.0.
2. **Legacy Codex Commands**: `c2c sandbox-allow` is preserved exclusively for legacy Codex backwards compatibility; standard Claude Code workflows use `c2c config-allow` without touching `~/.codex/config.toml`.

---

## 8. Git Status & Summary Statistics

```text
git status --short:
 M .claude/settings.json
 M PORT_REVIEW.md
 M README.md
 M README.zh-CN.md
 M docs/claude-code-port.md
 M src/cli/index.ts
 M src/config/claude-settings.ts
 M tests/claude-settings.test.ts

git diff --stat:
 .claude/settings.json         |  32 +++-
 PORT_REVIEW.md                | 142 ++++++++------
 README.md                     |   2 +-
 README.zh-CN.md               |   2 +-
 docs/claude-code-port.md      |   7 +-
 src/cli/index.ts              |   2 +-
 src/config/claude-settings.ts | 273 ++++++++++++++++++++++++-----
 tests/claude-settings.test.ts | 388 +++++++++++++++++++++++++++++++++---------
 8 files changed, 642 insertions(+), 206 deletions(-)
```

---

## 9. Final Gate Verdict

**ALL GATES PASSED (100% COMPLETE)**
- Build Pipeline: Clean (`tsc -p tsconfig.json`)
- Typecheck: Clean (`tsc --noEmit`, 0 errors)
- Automated Test Suite: 195/195 tests passing across 17 test suites (100% pass rate)
- No unauthorized git push executed.

