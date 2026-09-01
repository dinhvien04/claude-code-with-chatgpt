# Port Review & System Delivery: `claude-code-with-chatgpt`

> **Repository**: `dinhvien04/claude-code-with-chatgpt` (Forked & Ported from `XiaoDuoYa/codex-with-chatgpt`)  
> **Package Service**: `c2c-bridge` (CLI: `c2c`, Version: `0.1.1`)  
> **Core Principle**: *"ChatGPT thinks. Claude Code works."*  
> **Baseline Commit**: `abf779949bfcaf5148042c7a35b330fedb37c4fc`  
> **Lead Engineer Verification Date**: 2026-09-02  
> **Overall Port Status**: **CODE QUALITY GATES: PASS | END-TO-END RUNTIME VALIDATION: PENDING**

---

## 1. Corrective Pass Summary (Post-Audit Hardening)

Following independent multi-agent review sweeps and security verification against the official Claude Code settings schema and OpenAI subscription tiers, the following critical improvements were implemented:

1. **Deterministic Local Mode P Bundle Generator (`c2c bundle plan` & `c2c bundle review`)**:
   - Built a 100% local CLI tool generating bounded, sanitized context packages (`INIT_P` and `EXECUTED_P`).
   - Hard limits strictly enforced: total bundle <= 48 KB, directory tree <= 100 entries (depth <= 3), source snippets <= 200 lines / 16 KB (for up to 3 files), git diff <= 200 lines / 24 KB, execution output <= 150 lines / 12 KB.
   - Comprehensive security reuse: canonical path traversal protection (`Workspace.resolve`), sensitive file filtering (`IgnoreRules` blocking `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.git/**`, `.npmrc`), and credential redaction (`sanitizeExecutionOutput` scrubbing OpenAI, Anthropic, GCP, AWS tokens, and home directory paths).
2. **100% Local Mode P Execution**:
   - Zero `cloudflared`, zero tunnel creation, zero bridge daemons, zero OAuth/pairing codes, and zero `c2c setup` prerequisites required for Mode P.
3. **Split Installation & Setup Flows**:
   - Explicitly separated documentation and user onboarding into **Flow A: MCP Mode** (for ChatGPT Pro / Team / Enterprise / Edu / Business with Developer Mode) and **Flow B: Mode P** (for ChatGPT Plus / Free without MCP).
4. **Immediate Mode P Bypass in Claude Skill**:
   - Updated `.claude/skills/chatgpt-collab/SKILL.md` so `/chatgpt-collab --mode-p <goal>` immediately bypasses `c2c doctor`, `c2c setup`, and tunnel checks.
5. **Mode-Specific Security Rules Clarification**:
   - Clarified that "Never paste big content" applies to MCP Mode (< 1 KB control plane), while Mode P explicitly permits pasting bounded, sanitized context bundles while strictly forbidding raw whole-codebase dumps and raw secrets.
6. **Conservative OpenAI Tier Documentation**:
   - Accurately documented that custom MCP server connectors in Developer Mode are available for Pro, Team, Enterprise, Edu, and Business plans, while ChatGPT Plus ($20/mo) and Free plans use Mode P.
7. **Removal of Fragile Settings Hash URLs**:
   - Removed client-side hash routes (`https://chatgpt.com/#settings/Apps`) in `endpoint.ts` and `browser-agent.mjs`, standardizing on UI navigation (`Settings -> Apps -> Advanced Settings / Developer Mode`).
8. **RFC 6819 Section 5.2.2.3 Token Family Tracking & Replay Protection**:
   - Implemented `familyId`, generation counters, and persisted tombstones (`status: "used"`).
   - Presentation of an already-consumed refresh token triggers immediate detection of a replay attack, revoking all active access and refresh tokens across the entire family lineage.
9. **Fail-Closed Git-Ignore Handling**:
   - Configured `ensureIgnoreLocalSettings` to fail closed and throw `GitExcludeError` if Git exclude setup fails in a Git repository, preventing `.claude/settings.local.json` from ever being created without exclusion.
   - Handled non-Git directories cleanly with `.gitignore` fallback.
10. **Permission Allowlist Alignment**:
    - Added `"bundle"` to `REQUIRED_C2C_SUBCOMMANDS` so Claude Code CLI can execute `c2c bundle plan` and `c2c bundle review` without permission prompts.

---

## 2. Final Architecture Summary

The system implements a decoupled dual-plane architecture:
- **Reasoning / Review Plane (ChatGPT Web / Pro / Team / Enterprise / Edu / Plus)**: Operates within the official ChatGPT web interface to perform high-level planning, architectural reasoning, and code review without context window exhaustion.
- **Data Plane (C2C Bridge & Read-Only MCP)**: An Express HTTP daemon over Cloudflare Tunnel (Quick or Named) exposing exactly 9 read-only Model Context Protocol (MCP) tools secured by RFC 7591 Dynamic Client Registration, PKCE S256, RFC 6819 token family tracking, and 8-character CSPRNG pairing codes.
- **Execution Harness Plane (Claude Code CLI)**: Performs local file editing, terminal execution, compilation, testing, and git operations. The backend model is completely provider-neutral (Anthropic Claude, 9Router, Google Gemini, Amazon Bedrock, or custom local gateways).
- **Control Plane**: Standardized on **Mode C (Guided Manual Handoff)** as the 100% reliable default across all platforms for MCP-enabled plans, **Mode P** for Plus/Free 100% local manual handoff, and optional **Mode A** automated script support.

```
              ChatGPT Web (Pro / Team / Ent / Edu / Plus)
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
 ✓ tests/workspace.test.ts (20 tests)
 ✓ tests/git-ignore-failclosed.test.ts (3 tests)
 ✓ tests/search.test.ts (6 tests)
 ✓ tests/bundle.test.ts (9 tests)
 ✓ tests/prefs.test.ts (5 tests)
 ✓ tests/claude-settings.test.ts (20 tests)
 ✓ tests/tunnel.test.ts (22 tests)
 ✓ tests/runtime.test.ts (4 tests)
 ✓ tests/security-redteam.test.ts (24 tests)
 ✓ tests/execution-output.test.ts (7 tests)
 ✓ tests/oauth.test.ts (16 tests)
 ✓ tests/session.test.ts (14 tests)
 ✓ tests/sandbox-allow.test.ts (7 tests)
 ✓ tests/pairing.test.ts (8 tests)
 ✓ tests/claude-skill.test.ts (7 tests)
 ✓ tests/port.test.ts (2 tests)
 ✓ tests/endpoint.test.ts (8 tests)
 ✓ tests/mcp-integration.test.ts (16 tests)
 ✓ tests/git.test.ts (14 tests)

 Test Files  20 passed (20)
      Tests  217 passed (217)
   Duration  10.37s
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
- [x] unit tests succeed (217/217 passed across 20 test files)
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

---

## 6. Summary of Independent Multi-Agent Verification

- **Final Mode P Security & Implementation Reviewer**: **PASSED** — Verified `src/bundle/` implementation (`types.ts`, `tree.ts`, `snippets.ts`, `builder.ts`, `index.ts`), CLI commands `c2c bundle plan` and `c2c bundle review`, and regression suite `tests/bundle.test.ts`. Confirmed Mode P enforces all hierarchical budget limits (48 KB total, 100 tree entries/depth 3, 200 lines/16 KB snippets for <= 3 files, 200 lines/24 KB diffs, 150 lines/12 KB execution logs) and reuses `Workspace.readFile`, `IgnoreRules`, and `sanitizeExecutionOutput` with zero tunnel or daemon dependencies.
- **Final RFC 6819 Auth & Settings Reviewer**: **PASSED** — Verified `AuthStore` in `src/auth/store.ts` implements RFC 6819 Section 5.2.2.3 token family tracking with `familyId`, generation counters, tombstones (`status: "used"`), and cascade family revocation on replay detection. Verified fail-closed Git exclude handling via `GitExcludeError` in `claude-settings.ts` and inclusion of `"bundle"` in `REQUIRED_C2C_SUBCOMMANDS`.
- **Final Docs & Runtime Protocol Reviewer**: **PASSED** — Verified clean split between Flow A (MCP Mode for Pro/Team/Enterprise/Edu/Business) and Flow B (Mode P for Plus/Free), immediate Mode P bypass in `SKILL.md`, removal of obsolete hash URLs (`#settings/Apps`), and accurate mode-specific security guidelines.

---

## 7. Known Non-Blocking LOW Observations

1. **End-to-End Runtime Validation Status**: Automated test suite (217/217 tests across 20 files), typecheck, and build are 100% PASS; live browser pairing over Cloudflare tunnel remains PENDING user runtime execution.
2. **Legacy Codex Commands**: `c2c sandbox-allow` is preserved exclusively for legacy Codex backwards compatibility; standard Claude Code workflows use `c2c config-allow` without touching `~/.codex/config.toml`.

---

## 8. Final Gate Verdict

**CODE QUALITY GATES: PASS | END-TO-END RUNTIME VALIDATION: PENDING**
- Build Pipeline: Clean (`tsc -p tsconfig.json`)
- Typecheck: Clean (`tsc --noEmit`, 0 errors)
- Automated Test Suite: 217/217 tests passing across 20 test suites (100% pass rate)
- All security and architectural invariants strictly enforced.
- **No push executed** (per instructions).


