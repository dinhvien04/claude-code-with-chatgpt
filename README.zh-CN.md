# Claude Code with ChatGPT

[English](README.md) | **简体中文**

> ChatGPT thinks. Claude Code works.  
> ChatGPT 负责思考，Claude Code 负责干活。

> [!IMPORTANT]
> **遇到问题？** 请先在终端运行 `c2c doctor` 或在 Claude Code 中使用 `/chatgpt-collab` 自检。  
> **Having trouble?** First run `c2c doctor` or invoke `/chatgpt-collab` in Claude Code.

---

## 解决什么问题

ChatGPT 付费订阅（Plus / Pro）的网页版额度往往大量闲置，而本地编码 Agent 却在消耗昂贵且紧张的 API 额度进行繁琐的架构规划与代码审查。

本项目把“高阶推理与规划审查”交给您已付费的网页版 ChatGPT，Claude Code CLI 负责本地代码编辑、测试执行与 Git 维护。**无需逆向代理、无需向 ChatGPT 提供 API Key**——官方网页版 + 只读 MCP 桥接。

---

## 这是什么

将 ChatGPT 网页版转变为 Claude Code 编码会话的“规划与审查大脑”，而本地执行权完全保留在 Claude Code 手中。

- **代码不全量上传**：ChatGPT 仅通过 OAuth 2.1 保护的**只读 MCP 连接**，按需读取所需的文件片段与 Diff。
- **无感后端支持**：Claude Code 作为本地执行引擎，可透明兼容官方 Anthropic、9Router、Google Gemini、Bedrock 或各类自建 API 代理网关。

---

## 目标架构

```
                 ┌───────────────────────────────────────────────┐
                 │          ChatGPT Web / Projects               │
                 │       (Reasoning / Planning / Review)         │
                 └───────────────┬───────────────────────▲───────┘
                                 │                       │
                   MCP Data Plane│                       │ 控制面 (<1 KB)
            (Streamable HTTP + OAuth 2.1)                │ Mode C: 引导式手动交付
                                 ▼                       │ Mode A: 可选自动化脚本
                 ┌───────────────────────────────────────┴───────┐
                 │            C2C Bridge 守护进程                │
                 │  - 回环 HTTP (127.0.0.1:48765)                │
                 │  - OAuth 2.1 AS + PKCE (RFC 8414 / RFC 7591)  │
                 │  - CSPRNG 一次性配对管理器                     │
                 │  - 9 个严格只读 MCP 工具                      │
                 │  - Cloudflare 隧道 (Quick / Named)            │
                 │  - Windows & POSIX 路径加固与安全隔离         │
                 └───────────────────────┬───────────────────────┘
                                         │
                   规范化真实路径 (Realpath)│ 只读访问控制
                   大小写不敏感匹配      │
                   拒绝 NTFS 扩展流      │
                                         ▼
                 ┌───────────────────────────────────────────────┐
                 │                  本地工作区                   │
                 │   (源码文件, Git 仓库, .c2cignore)            │
                 └───────────────────────▲───────────────────────┘
                                         │
                     文件修改 / Shell    │ Git 提交 / 运行测试
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │            Claude Code CLI Harness            │
                 │  - .claude/skills/chatgpt-collab/SKILL.md     │
                 │  - 原生 Slash 命令: /chatgpt-collab           │
                 │  - 模型网关无关的本地执行引擎                 │
                 └───────────────────────────────────────────────┘
```

- **双平面解耦**：
  - **控制面（Control Plane）**：Claude Code 与 ChatGPT 仅传递轻量级 `[C2C]` 状态消息（`INIT → PLAN → EXECUTED → REVIEW → DONE`），控制消息体积严格小于 1 KB。绝不在提示词中大段粘贴源码或日志。
  - **数据面（MCP Data Plane）**：ChatGPT 缺什么拉什么，通过 9 个只读 MCP 工具自主调取：`workspace_info`、`list_directory`、`read_file`、`search_workspace`、`git_status`、`git_diff`、`test_status`、`execution_summary`、`execution_output`。
- **独立闭环审查**：Claude Code 执行完毕后，ChatGPT 亲自通过 MCP 检查真实的 git diff 和脱敏后的测试输出，绝不轻信口头汇报。

---

## 一段话安装（给 Claude Code CLI）

把下面这段话复制给 Claude Code：

```text
请帮我完整安装并配置 claude-code-with-chatgpt：

1. 环境自检：检查 git 与 Node.js ≥ 20，并确保已安装 cloudflared（macOS 用 brew，Windows 用 winget）。
2. 下载与构建：克隆仓库到 ~/claude-code-with-chatgpt（已存在则 git pull），执行 corepack pnpm install && corepack pnpm build。
3. 配置 Skill：将 .claude/skills/chatgpt-collab 安装到当前工作区或 ~/.claude/skills/chatgpt-collab，并更新实际克隆路径。
4. 启动服务：执行 c2c setup 启动本地桥接守护进程与隧道，获取公网 MCP 地址及一次性配对码。
5. 引导配对：指引我在 ChatGPT 网页版（设置 -> 安全 -> 开发者模式 -> 连接器）完成 Mode C 手动添加连接器与配对。
6. 验证 MCP 连通性（workspace_info 与只读测试），全部就绪后输出完成清单。
```

---

## 快速上手与操作流程

### 1. 手动安装
```bash
# 克隆仓库
git clone https://github.com/XiaoDuoYa/codex-with-chatgpt.git ~/claude-code-with-chatgpt
cd ~/claude-code-with-chatgpt

# 安装依赖并构建
corepack pnpm install
corepack pnpm build

# 全局软链接 c2c 命令（可选）
npm link
```

### 2. 配置 Claude Code Skill
确保在项目根目录或全局存在 `.claude/skills/chatgpt-collab/SKILL.md`。

### 3. 启动 Bridge 桥接服务
在您的目标项目根目录下运行：
```bash
c2c setup
```
该命令将自动启动后台回环守护进程并开启 Cloudflare 隧道，终端会显示：
- **公网 MCP 地址**（例如 `https://xxxx.trycloudflare.com/mcp`）
- **一次性配对码**（8 位字符，5 分钟有效）
- **连接器名称**（例如 `Claude Code with ChatGPT · my-project`）

### 4. 在 ChatGPT 网页版连接（Mode C: 引导式手动配对）
1. 打开 ChatGPT 网页版 -> **设置** -> **安全** -> 开启 **开发者模式**（Developer Mode）。
2. 进入 **连接器**（Connectors）设置（或访问 `https://chatgpt.com/plugins#settings/Connectors`）。
3. 点击 **新建连接器**（Create Connector）：
   - **名称**：填入 `c2c setup` 显示的连接器名称（如 `Claude Code with ChatGPT`）
   - **服务器 URL**：填入 `c2c setup` 给出的公网 MCP 地址（`https://...trycloudflare.com/mcp`）
   - **身份验证**：选择 `OAuth`
4. 点击 **连接 / 授权**，在弹出的配对窗口中输入 8 位配对码并提交。
5. 在 ChatGPT 中开启新会话，发送 **Boot Prompt**（见 `docs/protocol.md` 或通过 Claude Code 生成）。

### 5. 开始协作任务
在 Claude Code 中输入：
```text
/chatgpt-collab 帮我实现用户 JWT 认证与刷新机制
```
Claude Code 将生成格式化好的 `[C2C] STATE: INIT` 提示词。复制粘贴给 ChatGPT，随后将 ChatGPT 返回的 `[C2C] STATE: PLAN` 粘贴回 Claude Code，Claude Code 将执行修改、运行测试并生成审查请求。

*(可选 Mode A 模式)*：如已配置外部 Playwright 自动化环境，可使用 `node scripts/browser-agent.mjs` 辅助同步提示词。

---

## 安全模型与防线

- **从构造上严格只读**：服务端根本不存在写文件、删除、Shell 命令、Git 提交等破坏性工具，任何提示词注入（Prompt Injection）都无法突破只读边界。
- **强化路径收敛**：解析最深祖先的规范化真实路径（Canonical Realpath），严防 `../` 逃逸、符号链接越权、Windows NTFS 扩展数据流（`::$DATA`）、冒号和尾随点/空格绕过。
- **敏感文件防护**：硬性拦截私钥、`.env*`（允许 `.env.example`）、云凭证以及 `.git/` 内部元数据。
- **现代密钥脱敏**：执行日志自动过滤 OpenAI 项目密钥（`sk-proj-...`）、Anthropic 密钥（`sk-ant-...`）、Google API 密钥（`AIza...`）、Bearer 认证头以及用户主目录路径。
- **OAuth 2.1 + PKCE**：所有公网 MCP 端点均要求 RFC 8414 和 RFC 7591 规范的 Bearer 授权；配对码采用 CSPRNG 强随机生成并设有限频与防暴力破解机制。

完整威胁模型与安全策略请参阅 [docs/security.md](docs/security.md)。

---

## 常用 CLI 命令

```bash
# 核心生命周期
c2c setup           # 一键启动 Bridge、隧道并生成配对码
c2c status          # 查看 Bridge 运行状态、隧道与配对信息
c2c doctor          # 系统环境与连接诊断，支持自动修复
c2c pair            # 重新生成一个 8 位一次性配对码
c2c unpair          # 吊销当前工作区的所有授权令牌
c2c stop            # 停止后台 Bridge 守护进程与隧道
c2c logs            # 查看运行日志（添加 --verbose 查看详细输出）

# 配置与执行记录
c2c config-allow    # 自动将所需权限与路径写入 .claude/settings.json
c2c session         # 查看或管理当前任务断点状态
c2c record          # 记录本地执行与测试结果供 ChatGPT 审查
```

---

## 文档索引

- [系统架构详解](docs/architecture.md)
- [C2C 协作协议规范](docs/protocol.md)
- [安全模型与威胁分析](docs/security.md)
- [常见问题与故障排查](docs/troubleshooting.md)
- [Claude Code 移植与设计决策](docs/claude-code-port.md)

---

## 溯源致谢与开源许可证

本项目基于 [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt) 演进移植，专为 Claude Code CLI 与 Anthropic 开发者生态适配。

本项目采用 [MIT 开源许可证](LICENSE)。  
*非官方社区项目，与 Anthropic 或 OpenAI 均无官方关联。*
