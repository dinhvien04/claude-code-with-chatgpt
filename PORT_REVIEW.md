# Port Review & System Delivery: `claude-code-with-chatgpt`

> **Repository**: `dinhvien04/claude-code-with-chatgpt` (Forked & Ported from `XiaoDuoYa/codex-with-chatgpt`)  
> **Package Service**: `c2c-bridge` (CLI: `c2c`, Version: `0.1.1`)  
> **Core Principle**: *"ChatGPT thinks. Claude Code works."*  
> **Lead Engineer Verification Date**: 2026-09-01  
> **Overall Port Status**: **COMPLETE & VERIFIED (ALL GATES PASS)**

---

## 1. Final Architecture Summary

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

## 2. Inventory of Deliverables & Files

### A. New Architectural & Audit Deliverables
1. `UPSTREAM_ANALYSIS.md` — Deep inspection of original repository, dependencies, and assumptions.
2. `CLAUDE_ARCHITECTURE.md` — Complete architectural specification for the Claude Code runtime.
3. `PROTOCOL_AUDIT.md` — Wire protocol state machine and payload contract audit.
4. `SECURITY_AUDIT_PRE.md` — Initial threat model and static vulnerability analysis.
5. `CONTROL_PLANE_ANALYSIS.md` — Browser/UI capabilities and `ControlPlaneAdapter` design.
6. `TEST_PLAN.md` — Comprehensive test strategy and golden invariants catalog.
7. `PORT_PLAN.md` — Consensus porting blueprint approved by security, protocol, and architecture leads.
8. `ARCHITECTURE_REVIEW.md` — Independent adversarial architecture review.
9. `SECURITY_AUDIT_POST.md` — Independent post-implementation security audit.
10. `PROTOCOL_REVIEW.md` — Independent protocol state machine and schema audit.
11. `ADVERSARIAL_TEST_REVIEW.md` — Edge-case analysis, structural fuzzing review, and vulnerability catalog.
12. `SIMPLICITY_REVIEW.md` — Dead-code elimination and overengineering review.
13. `FINAL_FINDINGS.md` — Synthesis of confirmed defects and fix directives.
14. `PORT_REVIEW.md` — This comprehensive final delivery report.

### B. New Integration & Implementation Files
- `.claude/skills/chatgpt-collab/SKILL.md` — Canonical Claude Code project skill with progressive disclosure frontmatter, `/chatgpt-collab` command, prompt templates, and state recovery workflows.
- `.claude/settings.json` — Claude Code project settings and tool permissions.
- `scripts/browser-agent.mjs` — Optional Playwright automation script with automatic Mode C fallback.
- `docs/claude-code-port.md` — Detailed technical migration and architecture guide.
- `tests/claude-skill.test.ts` — Automated skill structure and prompt validation tests.
- `tests/security-redteam.test.ts` — Comprehensive security regression test suite (SEC-01 to SEC-07, DEF-01 to DEF-06).

### C. Modified Source & Test Files
- `src/workspace/manager.ts` — NTFS ADS (`::$DATA`), colon, trailing dot/space, and canonical realpath containment protections.
- `src/workspace/ignore.ts` — Case-insensitive sensitive file matching (`normCase`), `.git` file/directory denial, and expanded secret patterns.
- `src/workspace/git.ts` — Diff rename provenance protection and unborn HEAD handling.
- `src/execution/sanitize.ts` — Case-insensitive PEM private key hard rejection, modern API key redaction (`sk-proj-`, `sk-ant-`, `AIza`), multi-drive path redaction.
- `src/execution/records.ts` — Reverse-line resilient parsing for JSONL and optional `executor` identifier.
- `src/bridge/server.ts` — Proxy header rejection and constant-time admin bearer token verification (`timingSafeEqual`).
- `src/auth/oauth.ts` — Memory-bounded pending authorization requests.
- `src/mcp/server.ts` — Generalized executor tool descriptions.
- `README.md` & `README.zh-CN.md` — Modernized documentation, branding, and workflows.
- `docs/architecture.md`, `docs/protocol.md`, `docs/security.md`, `docs/troubleshooting.md` — Aligned with Claude Code architecture.
- `tests/execution-output.test.ts` & `tests/git.test.ts` — Expanded regression test coverage.

---

## 3. Generalized & Removed Codex Assumptions

1. **Decoupled Skill System**: Replaced Codex `$CODEX_HOME/skills/` with native `.claude/skills/chatgpt-collab/SKILL.md` while maintaining a backward-compatible mirror at `skill/SKILL.md`.
2. **Decoupled In-App Browser**: Eliminated hard dependency on `agent.browsers.get("iab")`. Standardized on Mode C (Guided Manual Handoff) as the reliable default.
3. **Decoupled Sandbox Configuration**: Replaced Codex `~/.codex/config.toml` TOML mutation with standard Claude Code `.claude/settings.json`.
4. **Generalized Protocol Metadata**: Replaced Codex-specific strings with generic `executor: "claude-code" | "codex" | "cli"`.

---

## 4. Security Guarantees & Invariants

- **ChatGPT Strictly Read-Only**: Exactly 9 read-only tools registered on MCP. Zero mutation, write, deletion, process spawn, or mutating git operations exposed.
- **Workspace Boundary Containment**: Canonical realpaths via `realpathSync.native` across deep path ancestors block `../`, `..\`, null bytes, and symlink escapes with `PATH_OUTSIDE_WORKSPACE`.
- **Defense-in-Depth Secret Protection**: Rejection of `.env*`, `.git/`, `.git`, private keys (`*.pem`, `*.key`, `id_*`), and cloud credentials across all tools and diffs.
- **Log Sanitization**: Hard rejection of case-insensitive private key blocks (`RSA`, `EC`, `OPENSSH`, `PGP`); modern API key token redaction; multi-drive home path redaction.
- **Admin API Protection**: Loopback-only binding, proxy header rejection, and constant-time token verification (`crypto.timingSafeEqual`).
- **OAuth 2.1 & PKCE**: RFC 7591 Dynamic Client Registration, PKCE S256, 8-character CSPRNG pairing codes with rate limiting, and SHA-256 hashed token storage.

---

## 5. Execution Commands & Verification Results

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
 ✓ tests/claude-settings.test.ts (6 tests)
 ✓ tests/workspace.test.ts (20 tests)
 ✓ tests/search.test.ts (6 tests)
 ✓ tests/session.test.ts (14 tests)
 ✓ tests/tunnel.test.ts (22 tests)
 ✓ tests/execution-output.test.ts (7 tests)
 ✓ tests/sandbox-allow.test.ts (7 tests)
 ✓ tests/port.test.ts (2 tests)
 ✓ tests/security-redteam.test.ts (24 tests)
 ✓ tests/runtime.test.ts (4 tests)
 ✓ tests/claude-skill.test.ts (7 tests)
 ✓ tests/pairing.test.ts (8 tests)
 ✓ tests/endpoint.test.ts (8 tests)
 ✓ tests/oauth.test.ts (16 tests)
 ✓ tests/mcp-integration.test.ts (16 tests)
 ✓ tests/git.test.ts (14 tests)

 Test Files  17 passed (17)
      Tests  186 passed (186)
   Duration  6.91s
```

### C. Build Pipeline
```bash
npm run build
> tsc -p tsconfig.json
# Exit code: 0 (dist/ generated cleanly)
```

### D. CLI Runtime Smoke Verification
- `node bin/c2c.js --version` -> `0.1.1` (OK)
- `node bin/c2c.js workspace --json` -> Verified workspace identification (OK)
- `node bin/c2c.js session get --json` -> Verified session resolution (OK)
- `node bin/c2c.js status --json` -> Verified clean daemon status reporting (OK)

---

## 6. Runtime Checklist

- [x] install succeeds
- [x] typecheck succeeds (0 errors)
- [x] unit tests succeed (186/186 passed)
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
- [x] Claude setup paths and settings are correct (`c2c config-allow` updates `.claude/settings.json`)
- [x] provider/model is not hardcoded (supports Anthropic, 9Router, Gemini, Bedrock, OpenAI)
- [x] 9Router is optional
- [x] Gemini is optional
- [x] Codex-specific assumptions remaining are documented and isolated to legacy commands
- [x] control-plane capability is represented truthfully (Mode C default, Mode A optional)
- [x] manual fallback works and is fully documented

---

## 7. Known Non-Blocking LOW Observations

1. **Refresh Token Family Revocation**: As identified in the security audit, standard single-use refresh token rotation is enforced; full family tree revocation under RFC 6819 is slated for v0.2.0.
2. **Legacy Codex Commands**: `c2c sandbox-allow` is preserved exclusively for legacy Codex backwards compatibility; standard Claude Code workflows use `c2c config-allow` without touching `~/.codex/config.toml`.

---

## 8. Summary of Independent Multi-Agent Verification

- **Reviewer A (Architecture & Port Fidelity)**: **PASSED** — Confirmed dual-plane separation, exactly 9 read-only MCP tools, OAuth 2.1 PKCE + CSPRNG pairing flow, connector lifecycle management, OS-specific state resolution, and complete decoupling of standard setup/doctor workflows from Codex config.
- **Reviewer B (Security & Sandbox Invariants)**: **PASSED** — Confirmed strict read-only tool surface (`readOnlyHint: true`), deepest-ancestor canonical realpath containment, NTFS ADS (`::$DATA`) and trailing dot/space rejection, platform-aware case-insensitive sensitive file filtering (`normCase`), log sanitization/private key hard rejection, timing-safe crypto comparison, rate limiting, and minimal-permission `.claude/settings.json` generation.
- **Reviewer C (Documentation & DevEx)**: **PASSED** — Confirmed git clone URLs in `README.md` and `README.zh-CN.md` point to `https://github.com/dinhvien04/claude-code-with-chatgpt.git`, upstream attribution to `XiaoDuoYa/codex-with-chatgpt` is preserved, CLI command documentation reflects current toolset (`c2c config-allow`, `c2c setup`, `c2c doctor`, `c2c pair`, `c2c status`, `c2c sandbox-allow`), and `browser-agent.mjs` accurately presents browser automation capabilities.

---

## 9. Final Gate Verdict

**ALL GATES PASSED (100% COMPLETE)**
- Build Pipeline: Clean (`tsc -p tsconfig.json`)
- Typecheck: Clean (`tsc --noEmit`, 0 errors)
- Automated Test Suite: 186/186 tests passing across 17 test suites (100% pass rate)
- All requirements from external audit fully remediated.
- No unauthorized git push executed.
