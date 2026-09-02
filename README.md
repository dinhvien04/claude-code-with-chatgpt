# Claude Code with ChatGPT

> ChatGPT thinks. Claude Code works.  
> ChatGPT 负责思考，Claude Code 负责干活。

> [!IMPORTANT]
> **遇到问题？** 请先运行 `c2c doctor` 或向 Claude Code 输入 `/chatgpt-collab doctor`。  
> **Having trouble?** First run `c2c doctor` or invoke `/chatgpt-collab doctor` in Claude Code.

---

## The Problem · 解决什么问题

**English** — ChatGPT Pro, Business, Enterprise, and Edu subscriptions include advanced reasoning capabilities and custom MCP developer connectivity (subject to admin policy on Business/Enterprise/Edu, and Developer Mode availability on Pro), but coding agents often burn scarce API tokens on high-level architecture, task decomposition, and code reviews. This project routes the heavy reasoning and planning to your ChatGPT web workspace, while Claude Code CLI executes code changes, runs tests, and manages git locally. For ChatGPT Plus and Free users where custom MCP connectors are not supported by OpenAI, a truthful manual context handoff (**Mode P**) is provided.

**中文** — ChatGPT Pro、Business、Enterprise 与 Edu 订阅包含高阶推理能力与自定义 MCP 开发者连接器（在 Business/Enterprise/Edu 上受组织管理策略控制，在 Pro 上受开发者模式支持），而本地编码 Agent 却在消耗昂贵的 API 额度进行架构规划和代码审查。本项目将“思考与审查”交给网页版 ChatGPT，Claude Code 只负责本地执行。针对 OpenAI 尚未支持自定义 MCP 连接器的 ChatGPT Plus 与 Free 用户，系统提供了专用的手动上下文交付模式（**Mode P**）。

---

## What It Is · 这是什么

**English** — Turn ChatGPT Web into an architectural planning and review co-pilot for your Claude Code sessions, while Claude Code retains 100% execution ownership.
- **For ChatGPT Pro / Business / Enterprise / Edu (MCP Mode)**: ChatGPT inspects only the exact files, diffs, and search results it needs on demand through an OAuth 2.1-secured, **strictly read-only** Model Context Protocol (MCP) connection (subject to plan and admin availability).
- **For ChatGPT Plus / Free (Mode P — Local Manual Context Handoff)**: Claude Code generates bounded, deterministic, and sanitized context/review bundles that can be pasted directly into ChatGPT Plus (reduces secret-exposure risk through sensitive-file blocking, path containment, and deterministic known-secret redaction).

**中文** — 将 ChatGPT 网页版作为 Claude Code 编码会话的“规划与审查大脑”，而本地执行权完全保留在 Claude Code 手中。
- **针对 ChatGPT Pro / Business / Enterprise / Edu（MCP 模式）**：ChatGPT 通过受 OAuth 2.1 保护的**严格只读** MCP 连接，按需调取所需的文件片段、diff 和搜索结果（视订阅类型与企业管理员策略而定）。
- **针对 ChatGPT Plus / Free（Mode P 手动上下文交付模式）**：Claude Code 生成严格受限、脱敏且经过安全过滤的上下文/审查数据包，直接复制到 ChatGPT Plus 中使用（通过敏感文件拦截、路径收敛与确定性已知密钥脱敏降低泄密风险）。

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
  - **Control Plane**: Claude Code and ChatGPT exchange minimal, structured `[C2C]` state messages (`INIT → PLAN → EXECUTED → REVIEW → DONE`). In MCP Mode, message payloads are strictly under 1 KB and no file contents, logs, or diffs are pasted directly [MCP-Mode-Only]. In Mode P, bounded, sanitized context packages are generated with strict byte caps.
  - **Data Plane (Read-Only MCP)**: ChatGPT queries workspace structure, files, git diffs, and test output on demand via 9 read-only MCP tools (`workspace_info`, `list_directory`, `read_file`, `search_workspace`, `git_status`, `git_diff`, `test_status`, `execution_summary`, `execution_output`).
- **Independent Verification Loop**: After Claude Code implements changes, ChatGPT inspects the actual git diff and sanitized execution records through MCP (or bounded review diff packages in Mode P) rather than blindly trusting local test reports.

---

## One-Paste Install · 一段话安装

Choose the prompt corresponding to your ChatGPT subscription tier:

### Flow A: MCP Mode (ChatGPT Pro / Business / Enterprise / Edu)
```text
Please install and configure "claude-code-with-chatgpt" for MCP Mode:

1. Environment check: Ensure git, Node.js >= 20, and cloudflared are installed (macOS: brew install cloudflared, Windows: winget install Cloudflare.cloudflared).
2. Clone & Build: Clone https://github.com/dinhvien04/claude-code-with-chatgpt.git into ~/claude-code-with-chatgpt (or pull if existing), then run `corepack pnpm install` and `corepack pnpm build`.
3. Skill & Permission Setup: Copy .claude/skills/chatgpt-collab to the local workspace's .claude/skills/chatgpt-collab (or global ~/.claude/skills/chatgpt-collab). Run `c2c config-allow -w .` in the target workspace to configure auto-approved permissions and sandbox state write paths in .claude/settings.local.json.
4. Initialization: Run `c2c setup -w .` to launch the local bridge daemon and generate the public pairing URL and one-time code.
5. Guide me through pairing in ChatGPT Web: Navigate to Settings -> Apps (or Developer Mode) -> Add Custom App / Connector and enter the MCP URL.
6. Verify connectivity and show a confirmation checklist when ready.
```

### Flow B: Mode P (ChatGPT Plus / Free — 100% Local, Zero Cloudflared/Daemon)
```text
Please install and configure "claude-code-with-chatgpt" for Mode P (Local Manual Context Handoff):

1. Environment check: Ensure git and Node.js >= 20 are available (NO cloudflared or tunnel required).
2. Clone & Build: Clone https://github.com/dinhvien04/claude-code-with-chatgpt.git into ~/claude-code-with-chatgpt (or pull if existing), then run `corepack pnpm install` and `corepack pnpm build`.
3. Skill & Permission Setup: Copy .claude/skills/chatgpt-collab to .claude/skills/chatgpt-collab (or global ~/.claude/skills/chatgpt-collab). Run `c2c config-allow -w .` in the workspace.
4. Verify readiness for Mode P (using `c2c bundle plan` and `/chatgpt-collab --mode-p <goal>`), with no background daemon or tunnel launched.
```

### 适用于 Claude Code（简体中文）

#### 方案 A：MCP 模式（ChatGPT Pro / Business / Enterprise / Edu）
```text
请帮我完整安装并配置 claude-code-with-chatgpt（MCP 模式）：

1. 环境自检：检查 git 与 Node.js ≥ 20，并确保已安装 cloudflared（macOS 用 brew，Windows 用 winget）。
2. 下载与构建：克隆仓库到 ~/claude-code-with-chatgpt（已存在则 git pull），执行 corepack pnpm install && corepack pnpm build。
3. 配置 Skill 与权限：将 .claude/skills/chatgpt-collab 放置到工作区或 ~/.claude/skills/chatgpt-collab，并在目标工作区执行 `c2c config-allow -w .` 将所需工具权限与沙箱状态写入路径自动配置到 .claude/settings.local.json。
4. 启动服务：执行 c2c setup -w . 启动本地桥接守护进程与隧道，获取公网 MCP 地址及一次性配对码。
5. 引导配对流程：在 ChatGPT 网页版进入 设置 -> Apps / 已连接应用（或开发者模式），添加自定义应用并填入 MCP 地址。
6. 验证连通性，全部就绪后输出完成清单。
```

#### 方案 B：Mode P 模式（ChatGPT Plus / Free — 纯本地，无需 cloudflared 与后台守护进程）
```text
请帮我配置 claude-code-with-chatgpt 的 Mode P（手动上下文交付模式）：

1. 环境自检：检查 git 与 Node.js ≥ 20（无需安装 cloudflared，无需任何内网穿透）。
2. 下载与构建：克隆仓库到 ~/claude-code-with-chatgpt（已存在则 git pull），执行 corepack pnpm install && corepack pnpm build。
3. 配置 Skill 与权限：将 .claude/skills/chatgpt-collab 放置到工作区或 ~/.claude/skills/chatgpt-collab，并在目标工作区执行 `c2c config-allow -w .`。
4. 验证 Mode P 准备就绪（可通过 `c2c bundle plan` 与 `/chatgpt-collab --mode-p 需求描述` 直接生成数据包），无需启动后台守护进程。
```

---

## Quickstart & Usage · 快速上手

### 1. Common Installation
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

### 2. Choose Your Workflow

```
                         COMMON INSTALLATION
                                  │
          ┌───────────────────────┴───────────────────────┐
          ▼                                               ▼
   Option A: Mode P                               Option B: MCP Mode
 (ChatGPT Plus / Free)                     (Pro / Business / Enterprise / Edu)
          │                                               │
   100% Local CLI                                  c2c config-allow -w .
   Zero cloudflared                                c2c setup -w .
   Zero bridge daemon                              Cloudflare Tunnel
   Zero OAuth / pairing                            OAuth Pairing in ChatGPT
```

---

### Option A: Mode P (ChatGPT Plus / Free — 100% Local, Zero Daemon / Tunnel)

*Note: OpenAI currently restricts custom MCP server connectors to Pro, Business, Enterprise, and Edu plans. If using ChatGPT Plus or Free, Mode P runs 100% locally with zero cloudflared, zero tunnel, zero daemon, and zero setup prerequisites.*

1. In Claude Code CLI, run `/chatgpt-collab --mode-p <goal>` or generate the planning package directly:
   ```bash
   c2c bundle plan -w . --goal "<goal>" --files "src/index.ts,src/app.ts"
   ```
2. Paste the generated bounded `[C2C] STATE: INIT_P` package into ChatGPT Plus. ChatGPT returns `[C2C] STATE: PLAN`.
3. Claude Code executes changes and tests locally.
4. Generate the review bundle (defaults to `head` mode, covering staged, unstaged, and safe untracked changes with review chunking support):
   ```bash
   c2c bundle review -w . --task c2c_0123456789abcdef --iteration 1
   ```
5. Paste `[C2C] STATE: EXECUTED_P` into ChatGPT Plus for audit. If changes span multiple chunks (`REVIEW_CHUNK: 1/N`), generate sequential chunks with `--chunk <n>` until `REVIEW_COMPLETE: true`.

---

### Option B: MCP Mode (ChatGPT Pro / Business / Enterprise / Edu)

1. Configure permissions in target workspace:
   ```bash
   c2c config-allow -w .
   ```
2. Initialize bridge daemon and Cloudflare tunnel:
   ```bash
   c2c setup -w .
   ```
   Outputs public MCP URL (e.g. `https://xxx.trycloudflare.com/mcp`), 8-character pairing code, and connector name.
3. Open ChatGPT Web -> **Settings** -> **Apps** -> **Advanced Settings** (or **Developer Mode**).
   *(Note: Custom MCP connectors on Business, Enterprise, and Edu are subject to workspace admin permissions; on Pro they require Developer Mode where available).*
4. Select **Add Custom App / Connector**:
   - **Name**: `Claude Code with ChatGPT`
   - **Server URL**: `https://...trycloudflare.com/mcp`
   - **Authentication**: `OAuth`
5. Click **Connect** / **Authorize**, enter the 8-character pairing code, and submit.
6. In your ChatGPT conversation, send the **Boot Prompt** (`/chatgpt-collab boot`) and select or `@mention` the connector app during prompts.

---

### 3. Running a Task
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

# Mode P (Local Bounded Handoff for Plus / Free)
c2c bundle plan     # Generate bounded [C2C] STATE: INIT_P bundle
c2c bundle review   # Generate bounded [C2C] STATE: EXECUTED_P bundle

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
