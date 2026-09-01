# Claude Code with ChatGPT

> ChatGPT thinks. Claude Code works.  
> ChatGPT 负责思考，Claude Code 负责干活。

> [!IMPORTANT]
> **遇到问题？** 请先运行 `c2c doctor` 或向 Claude Code 输入 `/chatgpt-collab doctor`。  
> **Having trouble?** First run `c2c doctor` or invoke `/chatgpt-collab doctor` in Claude Code.

---

## The Problem · 解决什么问题

**English** — ChatGPT Plus/Pro web quotas often sit idle while coding agents burn scarce API tokens on high-level architecture, task decomposition, and code reviews. This project routes the heavy reasoning and planning to your existing ChatGPT web subscription, while Claude Code CLI executes code changes, runs tests, and manages git locally. No reverse proxies, no API keys exposed to ChatGPT — just official web UI reasoning paired with a secure, read-only MCP bridge.

**中文** — ChatGPT 付费订阅（Plus / Pro）的网页版额度往往大量闲置，而本地编码 Agent 却在消耗昂贵的 API 额度进行架构规划和代码审查。本项目将“思考与审查”交给网页版 ChatGPT，Claude Code 只负责本地执行。无逆向代理、无需向 ChatGPT 提供 API Key——官方 Web UI 配合只读 MCP 桥接。

---

## What It Is · 这是什么

**English** — Turn ChatGPT Web into an architectural planning and review co-pilot for your Claude Code sessions, while Claude Code retains 100% execution ownership. Your entire repository is never uploaded in bulk: ChatGPT inspects only the exact files, diffs, and search results it needs on demand through an OAuth 2.1-secured, **strictly read-only** Model Context Protocol (MCP) connection.

**中文** — 将 ChatGPT 网页版作为 Claude Code 编码会话的“规划与审查大脑”，而本地执行权完全保留在 Claude Code 手中。项目代码永远不会被全量上传：ChatGPT 通过受 OAuth 2.1 保护的**严格只读** MCP 连接，仅按需调取所需的文件片段、diff 和搜索结果。

**Provider-Agnostic Executor** — Claude Code operates as the local execution engine and can be powered by any model provider (Anthropic, 9Router, Google Gemini, Amazon Bedrock, Google Vertex AI, or local proxy) without affecting the C2C Bridge architecture.

---

## Target Architecture · 系统架构

```
                 ┌───────────────────────────────────────────────┐
                 │          ChatGPT Web / Projects               │
                 │       (Reasoning / Planning / Review)         │
                 └───────────────┬───────────────────────▲───────┘
                                 │                       │
                   MCP Data Plane│                       │ Control Plane (<1 KB)
            (Streamable HTTP + OAuth 2.1)                │ Mode C: Guided Manual Handoff
                                 ▼                       │ Mode A: Optional Script
                 ┌───────────────────────────────────────┴───────┐
                 │            C2C Bridge Daemon                  │
                 │  - Loopback HTTP (127.0.0.1:48765)            │
                 │  - OAuth 2.1 AS + PKCE (RFC 8414 / RFC 7591)  │
                 │  - CSPRNG One-Time Pairing Manager            │
                 │  - 9 Read-Only MCP Tools                      │
                 │  - Cloudflare Tunnel (Quick / Named)          │
                 │  - Windows & POSIX Path Hardening             │
                 └───────────────────────┬───────────────────────┘
                                         │
                   Canonical Realpaths   │ Read-Only Containment
                   Case-Insensitive Match│
                   NTFS Stream Rejection │
                                         ▼
                 ┌───────────────────────────────────────────────┐
                 │               Local Workspace                 │
                 │   (Source files, git repo, .c2cignore)        │
                 └───────────────────────▲───────────────────────┘
                                         │
                     File Edits / Shell  │ Git Commits / Tests
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │            Claude Code CLI Harness            │
                 │  - .claude/skills/chatgpt-collab/SKILL.md     │
                 │  - Native Slash Command: /chatgpt-collab      │
                 │  - Provider-Agnostic Execution Engine         │
                 └───────────────────────────────────────────────┘
```

- **Dual-Plane Separation**:
  - **Control Plane**: Claude Code and ChatGPT exchange minimal, structured `[C2C]` state messages (`INIT → PLAN → EXECUTED → REVIEW → DONE`). Message payloads are strictly under 1 KB. No file contents, logs, or diffs are pasted directly.
  - **Data Plane (Read-Only MCP)**: ChatGPT queries workspace structure, files, git diffs, and test output on demand via 9 read-only MCP tools (`workspace_info`, `list_directory`, `read_file`, `search_workspace`, `git_status`, `git_diff`, `test_status`, `execution_summary`, `execution_output`).
- **Independent Verification Loop**: After Claude Code implements changes, ChatGPT inspects the actual git diff and sanitized execution records through MCP rather than blindly trusting local test reports.

---

## One-Paste Install · 一段话安装

### For Claude Code CLI (English)

Copy the prompt below and paste it to Claude Code:

```text
Please install and configure "claude-code-with-chatgpt" for me:

1. Environment check: Ensure git and Node.js >= 20 are available. Ensure cloudflared is installed (macOS: brew, Windows: winget).
2. Clone & Build: Clone https://github.com/dinhvien04/claude-code-with-chatgpt.git into ~/claude-code-with-chatgpt (or pull if existing), then run `corepack pnpm install` and `corepack pnpm build`.
3. Skill Setup: Copy .claude/skills/chatgpt-collab to the local workspace's .claude/skills/chatgpt-collab (or global ~/.claude/skills/chatgpt-collab), setting the checkout path.
4. Initialization: Run `c2c setup` to launch the local bridge daemon and generate the public pairing URL and one-time code.
5. Guide me through Mode C pairing in ChatGPT Web (Security -> Developer Mode -> Connectors -> Add Connector).
6. Verify file-read and workspace_info over MCP, and show a confirmation checklist when ready.
```

### 适用于 Claude Code（简体中文）

将以下提示词直接发送给 Claude Code：

```text
请帮我完整安装并配置 claude-code-with-chatgpt：

1. 环境自检：检查 git 与 Node.js ≥ 20，并确保已安装 cloudflared（macOS 使用 brew，Windows 使用 winget）。
2. 下载与构建：克隆仓库到 ~/claude-code-with-chatgpt（已存在则 git pull），执行 corepack pnpm install && corepack pnpm build。
3. 配置 Skill：将 .claude/skills/chatgpt-collab 放置到工作区或 ~/.claude/skills/chatgpt-collab，并更新实际克隆路径。
4. 启动服务：执行 c2c setup 启动本地桥接守护进程与隧道，获取公网 MCP 地址及一次性配对码。
5. 引导配对：指引我在 ChatGPT 网页版（设置 -> 安全 -> 开发者模式 -> 连接器）完成 Mode C 手动添加连接器与配对。
6. 验证 MCP 连通性（workspace_info 与只读测试），全部就绪后输出完成清单。
```

---

## Quickstart & Usage · 快速上手

### 1. Manual Installation
```bash
# Clone the repository
git clone https://github.com/dinhvien04/claude-code-with-chatgpt.git ~/claude-code-with-chatgpt
cd ~/claude-code-with-chatgpt

# Install dependencies and build
corepack pnpm install
corepack pnpm build

# Link CLI globally (optional)
npm link
```

### 2. Configure Claude Code Skill
Ensure `.claude/skills/chatgpt-collab/SKILL.md` is present in your project root or `~/.claude/skills/chatgpt-collab/SKILL.md`.

### 3. Initialize the Bridge
Inside your target project workspace:
```bash
c2c setup
```
This command starts the loopback daemon, establishes a Cloudflare tunnel, and outputs:
- **Public MCP Server URL** (e.g. `https://random-words.trycloudflare.com/mcp`)
- **One-Time Pairing Code** (8 characters, 5-minute validity)
- **Connector Name** (e.g. `Claude Code with ChatGPT · my-app`)

### 4. Connect in ChatGPT Web (Mode C: Guided Manual Handoff)
1. Open ChatGPT Web -> **Settings** -> **Security** -> Enable **Developer Mode**.
2. Go to **Settings** -> **Connectors** (or visit `https://chatgpt.com/plugins#settings/Connectors`).
3. Click **Create Connector**:
   - **Name**: `Claude Code with ChatGPT` (or your workspace connector name)
   - **Server URL**: The `https://...trycloudflare.com/mcp` URL provided by `c2c setup`
   - **Authentication**: `OAuth`
4. Click **Connect** / **Authorize**, enter the 8-character pairing code in the browser window, and submit.
5. In a new ChatGPT conversation, paste the **Boot Prompt** (available in `docs/protocol.md` or via `/chatgpt-collab boot`).

### 5. Running a Task
In Claude Code CLI:
```text
/chatgpt-collab Implement user authentication with JWT and refresh tokens
```
Claude Code will format the `[C2C] STATE: INIT` prompt for ChatGPT. Paste ChatGPT's `[C2C] STATE: PLAN` reply into Claude Code, and let Claude Code execute, test, and request review.

*(Optional Mode A)*: If external browser automation is preferred, `node scripts/browser-agent.mjs` can automate prompt transfers when explicitly configured.

---

## Security Model · 安全模型

- **Strictly Read-Only MCP**: No write, delete, shell execution, or git mutation tools exist on the bridge server. Prompt injection cannot execute destructive actions.
- **Hardened Path Containment**: Resolves canonical realpaths of the deepest ancestor; rejects path traversal (`../`), null bytes, Windows Alternate Data Streams (`::$DATA`), colons, and trailing dots/whitespace.
- **Sensitive Credential Protection**: Hard rejection of private keys, `.env*` files (allowing `.env.example`), cloud tokens, and `.git/` internal metadata.
- **Modern Secret Redaction**: Execution logs automatically scrub OpenAI project keys (`sk-proj-...`), Anthropic keys (`sk-ant-...`), Google API keys (`AIza...`), bearer headers, and user home directories.
- **OAuth 2.1 + PKCE**: All MCP endpoints require RFC 8414 and RFC 7591 compliant bearer authentication. Ephemeral pairing codes use CSPRNG (5-minute TTL, 5-attempt rate limit).

For detailed threat modeling and boundary guarantees, see [docs/security.md](docs/security.md).

---

## CLI Reference & Developer Guide

```bash
# Core Lifecycle Commands
c2c setup           # Start bridge, tunnel, and generate pairing code
c2c status          # Inspect daemon, tunnel, and pairing status
c2c doctor          # Diagnostic health check with automated auto-repair
c2c pair            # Generate a fresh 8-char pairing code
c2c unpair          # Revoke all OAuth tokens for the workspace
c2c stop            # Stop the background daemon and tunnel
c2c logs            # View bridge and access logs (--verbose for debug)

# Configuration & Permissions
c2c config-allow    # Configure .claude/settings.local.json permissions & sandbox write paths
c2c session         # View or manage active task checkpoints
c2c record          # Manually log execution iterations and test outcomes
```

### Building and Testing
```bash
pnpm install        # Install project dependencies
pnpm build          # Compile TypeScript to dist/
pnpm test           # Run Vitest test suites (workspace, auth, mcp, security)
pnpm typecheck      # Verify TypeScript strict type-checking
```

---

## Documentation Links

- [System Architecture](docs/architecture.md)
- [C2C Protocol Specification](docs/protocol.md)
- [Security & Threat Model](docs/security.md)
- [Troubleshooting & Diagnostics](docs/troubleshooting.md)
- [Claude Code Migration Guide](docs/claude-code-port.md)

---

## Upstream Attribution & License

This project is an evolution and port of [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt) adapted for the Claude Code CLI and Anthropic ecosystem.

Distributed under the [MIT License](LICENSE).  
*Unofficial community project. Not affiliated with or endorsed by Anthropic or OpenAI.*
