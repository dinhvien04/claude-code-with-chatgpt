# Architecture Review: `claude-code-with-chatgpt` Port

**Reviewer**: `architecture-reviewer`  
**Review Target**: Final Working Tree  
**Status**: Critical Architectural & Implementation Defects Identified  
**Mode**: Adversarial & Rigorous Verification  

---

## 1. Executive Verdict & Core Finding

The project claims to be **`claude-code-with-chatgpt`** ("ChatGPT thinks. Claude Code works.") — a port of OpenAI Codex bridge to Anthropic Claude Code. However, an adversarial deep-dive into the codebase reveals that **the port is architecturally incomplete, contains dead/vestigial systems, has multiple documentation-to-implementation divergences, and retains heavy legacy Codex baggage masquerading as a Claude Code port.**

While the Model Context Protocol (MCP) data plane and the HTTP bridge server are functional and secure, the **control plane, configuration sub-system, CLI nomenclature, and developer ergonomics are fundamentally split across two incompatible models**:
1. It presents a Claude Code facade via `.claude/skills/chatgpt-collab/SKILL.md` and documentation claims (`CLAUDE_ARCHITECTURE.md`, `README.md`).
2. The core implementation (`src/cli/index.ts`, `src/config/sandbox-allow.ts`, `src/config/paths.ts`, `src/config/ui-prefs.ts`, `package.json`, `skill/SKILL.md`) is still hardcoded for OpenAI Codex semantics (`~/.codex/config.toml`, `[sandbox_workspace_write].writable_roots`, state directory paths `codex-with-chatgpt`, `control-in-app-browser`).

---

## 2. Unwanted Codex Coupling & Vestigial Code

### 2.1 Hardcoded Codex State Directory Path
- **File & Line**: `src/config/paths.ts:15,17,20`
  ```typescript
  case "darwin":
    return path.join(home, "Library", "Application Support", "codex-with-chatgpt");
  case "win32":
    return path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "codex-with-chatgpt");
  default: {
    const base = process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state");
    return path.join(base, "codex-with-chatgpt");
  }
  ```
- **Architectural Violation**: The runtime state directory is hardcoded to `codex-with-chatgpt`. Despite rebranding to Claude Code (`claude-code-with-chatgpt`), all runtime locks, authentication tokens, pairing sessions, and tunnel state files are saved under the legacy `codex-with-chatgpt` directory.
- **Impact**: Cross-contamination with existing Codex installations, confusion during state debugging, and violation of Claude Code isolation boundaries.

### 2.2 CLI Still Writes to `~/.codex/config.toml` (Codex Sandbox Allowlist)
- **File & Line**: `src/cli/index.ts:29, 129-138, 404-421, 759-777`
- **File & Line**: `src/config/sandbox-allow.ts:6-8, 29-38, 67-89, 117-146`
  ```typescript
  // src/config/sandbox-allow.ts:29-37
  export function getCodexHome(): string {
    const fromEnv = process.env.CODEX_HOME?.trim();
    if (fromEnv) return path.resolve(fromEnv);
    return path.join(os.homedir(), ".codex");
  }

  export function getCodexConfigPath(): string {
    return path.join(getCodexHome(), "config.toml");
  }
  ```
- **Architectural Violation**: 
  - `c2c doctor` (lines 404-421) and `c2c setup` (line 264) explicitly check and mutate `~/.codex/config.toml` by parsing TOML tables (`[sandbox_workspace_write].writable_roots`).
  - Claude Code does **not** use `~/.codex/config.toml` or TOML-based writable roots. Claude Code uses `.claude/settings.json` or `~/.claude/settings.json` with JSON permissions (`permissions.allow`, `permissions.additionalDirectories`, `sandbox.filesystem.allowWrite`).
  - A Claude Code user running `c2c setup` or `c2c doctor` is mutating a non-existent or irrelevant `~/.codex/` directory rather than granting permissions in Claude Code.

### 2.3 Package Metadata and Product Constants
- **File & Line**: `package.json:2-4`
  ```json
  "name": "codex-with-chatgpt",
  "version": "0.1.1",
  "description": "ChatGPT thinks. Codex works. Use ChatGPT as the planning brain while keeping the Codex harness."
  ```
- **File & Line**: `src/version.ts:3`
  ```typescript
  export const PRODUCT_NAME = "Codex with ChatGPT";
  ```
- **File & Line**: `src/config/endpoint.ts:9`
  ```typescript
  export const DEFAULT_CONNECTOR_NAME = "Codex with ChatGPT";
  ```
- **Architectural Violation**: The package identity, product string, default connector names, and package description are completely unported. In runtime logs, OAuth authorization pages (`src/auth/html.ts`, `src/auth/oauth.ts:64, 88`), and default ChatGPT connector names, the system announces itself as "Codex with ChatGPT".

### 2.4 Lingering Legacy Codex Skill
- **File & Line**: `skill/SKILL.md:1-698`
- **Architectural Violation**: The repository contains `skill/SKILL.md` (which instructs the agent to use `control-in-app-browser`, `agent.browsers.get("iab")`, and `tab.markHandoff()`) alongside `.claude/skills/chatgpt-collab/SKILL.md`. Having two competing skill definitions with mutually exclusive execution models (Codex embedded IAB vs Claude Code Mode C CLI) creates confusion and build drift.

---

## 3. Fake Abstractions & Mock Implementations

### 3.1 Ghost Function `ensureClaudeSettings`
- **File & Line**: `src/config/sandbox-allow.ts:94-115`
  ```typescript
  export function ensureClaudeSettings(opts?: {
    settingsPath?: string;
    workspaceRoot?: string;
  }): ClaudeAllowResult {
    const settingsPath = opts?.settingsPath ?? getClaudeSettingsPath(opts?.workspaceRoot);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

    let existing: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }

    return {
      added: !fs.existsSync(settingsPath),
      alreadyAllowed: fs.existsSync(settingsPath),
      settingsPath,
    };
  }
  ```
- **Architectural Violation**: 
  - This function is a **fake abstraction**. It reads `.claude/settings.json`, does **not** update `permissions.allow`, does **not** add `permissions.additionalDirectories`, does **not** configure hooks, and is **never called by any CLI command or server module anywhere in `src/`**.
  - It exists only as a token gesture to pass a superficial code search without actually implementing Claude Code settings management.

### 3.2 Fictitious Command `c2c config-allow` Documented But Non-Existent
- **File & Line**: `README.md:186`
  ```bash
  # Configuration & Permissions
  c2c config-allow    # Configure .claude/settings.json permissions & writable paths
  ```
- **File & Line**: `CLAUDE_ARCHITECTURE.md:160, 385, 410`
- **File & Line**: `docs/architecture.md:86`
- **Architectural Violation**:
  - The documentation in `README.md`, `CLAUDE_ARCHITECTURE.md`, and `docs/architecture.md` repeatedly claims the CLI supports `c2c config-allow`.
  - In reality, searching `src/cli/index.ts` shows `program.command("config-allow")` **does not exist**. Only `program.command("sandbox-allow")` (which writes to Codex `config.toml`) is registered.
  - Any Claude Code user following the README or executing `c2c config-allow` will receive `error: unknown command 'config-allow'`.

### 3.3 Outdated UI Prefs Text Referencing Non-Existent In-App Browser
- **File & Line**: `src/config/ui-prefs.ts:9-23`
  ```typescript
  export const SETUP_CHOICE_PROMPT = [
    "首次连接 ChatGPT 前，请选择一种配置方式（选一次即可，之后默认沿用）：",
    "",
    "**1. AI 自动化配置（预览版）**",
    "由我在内置浏览器里完成全部设置，你只需在需要登录、验证码或二次确认时操作一次。",
    ...
  ```
- **Architectural Violation**:
  - In Claude Code CLI, there is **no built-in browser**.
  - `src/config/ui-prefs.ts` still tells the user "由我在内置浏览器里完成全部设置" (Done by me in the built-in browser), which was designed for Codex's Electron In-App Browser (`iab`).
  - If a user chooses "1", Claude Code cannot perform the setup inside any built-in browser.

---

## 4. Duplicated Systems & Split Reality

### 4.1 Divergent Skill Definitions (`skill/` vs `.claude/skills/`)
| Characteristic | `skill/SKILL.md` (Legacy Codex) | `.claude/skills/chatgpt-collab/SKILL.md` (Claude Code) |
| :--- | :--- | :--- |
| **Control Plane** | `control-in-app-browser` (`iab`), `tab.markHandoff()`, `agent.browsers.get("iab")` | Mode C (Guided Manual Handoff copy-paste) + Mode A (`scripts/browser-agent.mjs`) |
| **Configuration** | `c2c sandbox-allow` mutating `~/.codex/config.toml` | `.claude/settings.json` permissions allowlist |
| **Skill Name** | `codex-with-chatgpt` | `chatgpt-collab` |
| **Status in Repo** | Root `skill/SKILL.md` | `.claude/skills/chatgpt-collab/SKILL.md` |

- **Architectural Defect**: These two skills represent completely different control plane philosophies. The repository ships both without a clear single source of truth, causing confusion for maintenance and automated tooling.

---

## 5. Incorrect Executor Boundaries (Claude Code vs ChatGPT)

### 5.1 Dual-Plane Boundary Assessment
The data plane boundary is well-architected and adheres strictly to read-only semantics:
- `workspace_info`, `list_directory`, `read_file`, `search_workspace`, `git_status`, `git_diff`, `test_status`, `execution_summary`, `execution_output` are all read-only (`annotations: { readOnlyHint: true }`).
- Execution of commands, test runs, code editing, and file creation remain exclusively on the local executor side (Claude Code).

### 5.2 Control Plane Handoff Friction & Failure Modes
- While Mode C is conceptually sound for terminal CLIs, the state tracking in `src/cli/index.ts` (`c2c session`, `c2c record`) relies on manual CLI invocations by Claude Code:
  ```bash
  c2c session set -w . --task c2c_a1b2 --iteration 1 --state EXECUTED --protocol-state EXECUTED_LOCAL
  c2c record -w . --task c2c_a1b2 --iteration 1 --changed-files "..." --tests "..." --exit-status ok
  ```
- **Boundary Vulnerability**: In Claude Code, tool execution is not automatically intercepted unless hooks are configured in `.claude/settings.json`.
- In the current repository, `.claude/settings.json` only contains permission allowlists:
  ```json
  {
    "permissions": {
      "allow": [
        "Bash(c2c *)",
        "Bash(node bin/c2c.js *)",
        "Bash(pnpm test*)",
        "Bash(pnpm typecheck*)",
        "Bash(pnpm build*)"
      ]
    }
  }
  ```
- The lifecycle hooks described in `CLAUDE_ARCHITECTURE.md:168-206` (`SessionStart`, `PostToolUse`) **do not exist in `.claude/settings.json`**.
- As a result, execution recording is 100% manual and dependent on Claude Code remembering to execute CLI commands in sequence, creating high cognitive load and frequent state drift when Claude Code forgets to call `c2c record`.

---

## 6. Provider Hardcoding Analysis (Gemini, 9Router, Anthropic)

### 6.1 Backend Isolation Check
- **Grep Verification**: Full-text regex search across `src/` for `gemini`, `9router`, `anthropic`, `openai`, `claude-3`, `claude-sonnet`, `gpt-4` yields **zero hardcoded model API calls or provider couplings in `src/`**.
- **Assessment**: **PASSED**. The bridge runtime (`src/`) is truly provider-agnostic. It acts as an MCP server and OAuth authorization server without depending on the LLM powering Claude Code or ChatGPT.

---

## 7. Claude Code Integration Correctness

### 7.1 `.claude/skills/chatgpt-collab/SKILL.md`
- **Strengths**:
  - Valid YAML frontmatter (`name: chatgpt-collab`, `description: ...`).
  - Clear 6-section structure with golden rules and dual-plane separation.
  - Complete prompt templates (`INIT`, `PLAN`, `EXECUTED`, `HANDOFF`).
  - Clear checkpoint state transition table matching `src/session/state.ts`.
- **Weaknesses**:
  - References `c2c record` options that rely on manual agent tool calls rather than automatic Claude Code hooks.
  - Claims `c2c setup` and `c2c doctor` manage environment health, but `c2c doctor` reports on Codex sandbox writable roots (`report.sandbox`), which is irrelevant to Claude Code.

### 7.2 `.claude/settings.json`
- **Strengths**: Contains proper command allowlists for `c2c`, `node bin/c2c.js`, and `pnpm`.
- **Defects**:
  - Missing `additionalDirectories` allowing the bridge state directory (`%LOCALAPPDATA%\codex-with-chatgpt` or `~/.local/state/codex-with-chatgpt`).
  - Missing `SessionStart` and `PostToolUse` lifecycle hooks documented in architectural specs.

### 7.3 `scripts/browser-agent.mjs`
- **Strengths**:
  - Pragmatic implementation with immediate fallback to Mode C.
  - Does not crash if Playwright is missing; prints clear Mode C manual steps.
  - Accurately targets ChatGPT connectors URL and login walls.
- **Weaknesses**:
  - Marked as an optional helper, but `c2c setup` output does not invoke or reference it. It lives as a detached script with minimal runtime integration.

---

## 8. Maintainability, Code Hygiene & Test Suite

### 8.1 Build & Test Status
- **Vitest Suite**: 16 test files, 178 tests all pass (`npx vitest run`).
- **TypeScript Compilation**: `npx tsc --noEmit` exits clean with 0 errors.
- **Pnpm Compatibility Issue**: Running `pnpm test` fails in Node.js 20.20 due to `pnpm@11.24.0` requiring `node:sqlite` (Node.js >= 22.13). The project should either pin a compatible pnpm version in `package.json` (`packageManager: "pnpm@9.x"`) or update the `engines` field.

### 8.2 Discrepancies between Tests and Implementation
- `tests/sandbox-allow.test.ts` extensively tests TOML parsing and Codex `config.toml` mutation (`writable_roots`), perpetuating the false assumption that this is a Codex project.
- There are no integration tests verifying that Claude Code `.claude/settings.json` permissions or paths are properly configured by the CLI.

---

## 9. Comprehensive Defect & Recommendation Matrix

| ID | Category | Severity | Exact File & Line | Description | Required Remediation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DEF-01** | Codex Coupling | **High** | `src/config/paths.ts:15,17,20` | State directory hardcoded to `codex-with-chatgpt` | Rename default state directory to `claude-code-with-chatgpt` (or `c2c`). |
| **DEF-02** | Codex Coupling | **High** | `src/cli/index.ts:264, 404-421, 759-777` | CLI commands `setup`, `doctor`, `sandbox-allow` mutate `~/.codex/config.toml` | Deprecate Codex TOML mutation in favor of Claude Code `.claude/settings.json` management. |
| **DEF-03** | Fake Abstraction | **High** | `src/config/sandbox-allow.ts:94-115` | `ensureClaudeSettings` is an unused, inert stub | Implement full `.claude/settings.json` reader/updater and wire it to a real CLI command. |
| **DEF-04** | Missing Feature | **Medium** | `src/cli/index.ts` / `README.md:186` | Documented command `c2c config-allow` does not exist in Commander CLI | Implement `c2c config-allow` in `src/cli/index.ts` (alias or replace `sandbox-allow`). |
| **DEF-05** | Branding/Identity | **Medium** | `package.json:2-4`, `src/version.ts:3`, `src/config/endpoint.ts:9` | Package name is `codex-with-chatgpt`, `PRODUCT_NAME` is `Codex with ChatGPT` | Update to `claude-code-with-chatgpt` and `Claude Code with ChatGPT`. |
| **DEF-06** | Dead/Conflicting Code | **Medium** | `skill/SKILL.md:1-698` | Legacy Codex skill with `control-in-app-browser` still exists in root | Move to `deprecated/` or remove in favor of `.claude/skills/chatgpt-collab/SKILL.md`. |
| **DEF-07** | Configuration Drift | **Low** | `.claude/settings.json` | Missing `additionalDirectories` and lifecycle hooks | Add state directory to `permissions.additionalDirectories` and define automated hooks. |
| **DEF-08** | Stale User Prompts | **Low** | `src/config/ui-prefs.ts:9-23` | Setup prompt refers to "内置浏览器" (built-in browser) | Update prompt to describe Mode C (Manual Copy-Paste) and Mode A (Scripted Browser). |
| **DEF-09** | Engine / Pnpm Mismatch | **Low** | `package.json:20` | `packageManager: "pnpm@11.24.0"` fails on Node.js 20 | Pin `pnpm@9.x` or update `engines` to `"node": ">=22.13"`. |

---

## 10. Conclusion

The port is **architecturally sound in its MCP data plane and security perimeter**, but **architecturally incomplete in its CLI harness, configuration model, and product identity**. It remains tethered to OpenAI Codex configuration files (`~/.codex/config.toml`) while advertising itself as a Claude Code integration.

To consider this port architecturally finished and honest, the team must address **DEF-01 through DEF-06**, transitioning the configuration engine from Codex TOML writable roots to native `.claude/settings.json` permissions.
