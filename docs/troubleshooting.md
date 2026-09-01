# Troubleshooting & Diagnostics

> **First Step**: Always run the automated self-diagnostic tool first:
> ```bash
> c2c doctor
> ```
> `c2c doctor` automatically inspects Node.js, the local workspace, bridge daemon status, MCP endpoint availability, OAuth state, and Cloudflare tunnel connectivity, auto-repairing transient faults whenever possible.

---

## 1. Claude Code Specific Diagnostics

### Skill Not Found / Slash Command `/chatgpt-collab` Unavailable
- **Symptom**: Claude Code reports that the skill or command `/chatgpt-collab` does not exist.
- **Cause**: The skill is not installed in the workspace's `.claude/skills/` directory or global `~/.claude/skills/`.
- **Fix**:
  1. Ensure the directory `.claude/skills/chatgpt-collab/SKILL.md` exists in your workspace root.
  2. For global availability across all projects, copy the skill to `~/.claude/skills/chatgpt-collab/SKILL.md` (`%USERPROFILE%\.claude\skills\chatgpt-collab\SKILL.md` on Windows).
  3. Verify that the `name: chatgpt-collab` YAML frontmatter is intact.

### Permission Prompts on Every `c2c` or `git` Execution
- **Symptom**: Claude Code repeatedly interrupts execution with permission approval dialogs for `c2c` or test commands.
- **Cause**: `.claude/settings.json` has not registered permissions for the `c2c` CLI binary and state directory.
- **Fix**:
  Run the automatic permission configurator:
  ```bash
  c2c config-allow
  ```
  This command idempotently updates `.claude/settings.json` (or `~/.claude/settings.json`), adding the necessary CLI execution permissions and allowlisting the application state directory.

### Writable Path / Sandbox Permission Denied (EPERM)
- **Symptom**: Bridge daemon fails to write logs or state files with `EPERM` or `Operation not permitted`.
- **Cause**: The state directory (`%LOCALAPPDATA%\claude-code-with-chatgpt` on Windows or `~/Library/Application Support/claude-code-with-chatgpt` on macOS) is blocked by Claude Code's sandbox.
- **Fix**:
  Run `c2c config-allow` and restart Claude Code. If permissions were set at the user level, ensure your terminal process has standard write access to your OS application data folder.

---

## 2. Connectivity & Tunnel Diagnostics

### "Bridge Not Running" / "Bridge 未运行"
- **Fix**: Run `c2c start` or let `c2c doctor` start the daemon.
- Inspect detailed logs with:
  ```bash
  c2c logs --verbose
  ```
- If `c2c doctor` reports the bridge state is **uncertain** (`状态无法确认`), wait 5 seconds and rerun `c2c doctor`. Do not launch multiple competing bridge daemons.

### Cloudflare Tunnel Unreachable / ChatGPT Reports Connector Broken
- **Symptom**: ChatGPT displays an error that the MCP connector cannot reach the server URL.
- **Cause**: Quitting the terminal or restarting the computer terminates the temporary Quick Tunnel (`*.trycloudflare.com`).
- **Fix**:
  1. Run `c2c doctor`. If the public URL has changed, doctor flags `chatgptRepair.needed: true`.
  2. Open ChatGPT Web -> **Settings** -> **Connectors** (or visit `https://chatgpt.com/plugins`).
  3. **Delete** the existing connector for this workspace (do not click *Reconnect* — the old URL is permanently dead).
  4. Click **Create Connector** and paste the new `https://...trycloudflare.com/mcp` URL provided by `c2c doctor`.
  5. Run `c2c pair` to generate a fresh pairing code, then click **Connect / Authorize**.

### Stable Hostnames (Named Cloudflare Tunnels)
- If you own a domain configured on Cloudflare, you can avoid rotating connector URLs:
  ```bash
  c2c tunnel choose --mode named --zone your-domain.com
  ```
- This binds a persistent URL (e.g. `https://c2c-myproject.your-domain.com/mcp`) that survives reboots and daemon restarts. If a named tunnel disconnects, run `c2c tunnel login` to refresh Cloudflare credentials without having to re-create the connector in ChatGPT.

### `cloudflared` Executable Missing
- **macOS**: `brew install cloudflared`
- **Windows**: `winget install Cloudflare.cloudflared`
- **Linux**: Install via official Cloudflare package repositories (`apt-get install cloudflared` / `dnf install cloudflared`).
- *Custom Path*: If installed in a non-standard location, set the environment variable `C2C_CLOUDFLARED_PATH` to the absolute binary path.

---

## 3. Authentication & Pairing Code Issues

### "Pairing Code Invalid or Expired" / "配对码无效或过期"
- **Cause**: Pairing codes have a 5-minute time-to-live (TTL), allow at most 5 attempts, and are invalidated immediately upon use.
- **Fix**:
  Generate a fresh code by running:
  ```bash
  c2c pair
  ```
  Enter the new 8-character code in the browser authorization window immediately.

### ChatGPT Gets `401 Unauthorized` on Every MCP Tool Call
- **Cause**: The OAuth access token expired and the refresh token was revoked (e.g. after running `c2c unpair` or extended offline periods).
- **Fix**:
  1. In ChatGPT Web -> **Settings** -> **Connectors**, select the connector.
  2. Run `c2c pair` in the terminal to obtain a fresh pairing code.
  3. Click **Authorize** in ChatGPT Web and enter the code.

### Port Conflict (Port 48765 Occupied)
- **Behavior**: The C2C bridge detects port collisions automatically. If the occupying process is a healthy C2C daemon for the same workspace, it is reused. If occupied by another program, the bridge automatically selects an ephemeral loopback port.
- Configuration and port resolution are handled transparently via local state files without requiring manual port reassignment.

---

## 4. Workspace & Security Policy Diagnostics

### File Read Returns `ACCESS_DENIED_SENSITIVE_FILE`
- **Behavior**: Working as intended by design. Sensitive files (`.env`, private keys, cloud credentials, `.git/` metadata) are strictly blocked from MCP reads.
- **Note**: `.env.example` is explicitly permitted for architectural review.
- Custom exclusion rules can be added to your project's `.c2cignore` file.

### ChatGPT Projects Sidebar Not Visible
- In ChatGPT Web, hover over **Chats** in the left sidebar, click the `…` (three dots) menu, and select **Organize by project**.
- Create a project named after your workspace with **Project-only memory** enabled, and bind the workspace connector.

---

## 5. Complete Reset Procedure

If the bridge or pairing state enters an unrecoverable state:
```bash
# 1. Stop all daemons and tunnels
c2c stop

# 2. Revoke all active OAuth tokens
c2c unpair

# 3. Restart the bridge and generate a fresh pairing session
c2c setup

# 4. Update the connector in ChatGPT Web with the new URL and pairing code
```
