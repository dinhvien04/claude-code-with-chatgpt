# Security & Threat Model

> **Core Philosophy**: Absolute defense-in-depth for local developer environments.  
> The bridge exposes read-only MCP tools to ChatGPT Web while guaranteeing that no private credentials leave the machine and no mutating operations can ever be performed over the wire.

---

## 1. Trust Boundaries & Invariants

```
                                  INTERNET / UNTRUSTED
                                           │
                                           ▼ (HTTPS / TLS 1.3)
                       ┌───────────────────────────────────────┐
                       │           Cloudflare Tunnel           │
                       └───────────────────┬───────────────────┘
                                           │
                                           ▼ Loopback (127.0.0.1:48765)
                       ┌───────────────────────────────────────┐
                       │          C2C Bridge Daemon            │
                       │ ├── OAuth 2.1 AS + PKCE (RFC 7636)    │
                       │ ├── CSPRNG One-Time Pairing Code      │
                       │ └── 9 Read-Only MCP Tool Endpoints    │
                       └───────────────────┬───────────────────┘
                                           │
                     ┌─────────────────────┴─────────────────────┐
                     │            LOCAL SECURITY GATES           │
                     │ ├── Canonical Realpath Resolution         │
                     │ ├── Case-Insensitive Pattern Matcher      │
                     │ ├── NTFS ADS & Trailing Dot Denials       │
                     │ └── Sensitive File Deny-by-Default        │
                     └─────────────────────┬─────────────────────┘
                                           │
                                           ▼
                       ┌───────────────────────────────────────┐
                       │            Local Workspace            │
                       │         (Isolated Repository)         │
                       └───────────────────────────────────────┘
```

1. **Workspace Root is the Ultimate Boundary**: One bridge daemon serves exactly one workspace. Every issued token is bound to a specific `workspace_id`. A token issued for Project A returns `403 Forbidden` on Project B's bridge.
2. **Untrusted Model & Workspace Content**: Workspace files, commit messages, and prompt responses are treated as untrusted data that may contain prompt injection attempts. Tools never execute shell commands or write files based on MCP requests.
3. **Strict Read-Only by Construction**: The bridge exposes 9 read-only inspection tools. Tools for file writing, deletion, shell command execution, process spawning, or git mutation do not exist in the codebase.
4. **Zero Long-Lived Browser Credential Exposure**: The only secret entered into a browser during setup is an ephemeral, 8-character CSPRNG pairing code.

---

## 2. Threat Model & Mitigations

| Threat Vector | Attack Scenario | Defense & Mitigation Mechanism |
| :--- | :--- | :--- |
| **Public URL Leakage** | An attacker discovers or scans the public Cloudflare tunnel URL. | Every `/mcp` request requires a valid OAuth 2.1 Bearer token. Unauthenticated requests return `401 Unauthorized`. Tokens for mismatched workspaces return `403 Forbidden`. |
| **Pairing Code Brute-Force** | An attacker attempts to guess the 8-character pairing code. | 8 alphanumeric characters drawn from a 31-character CSPRNG alphabet (~40 bits of entropy). Hard rate limits (max 10 attempts/min per IP, 5 failed attempts per session). 5-minute TTL. Destroyed on use. |
| **OAuth Interception & CSRF** | MitM or malicious site tries to forge authorization responses. | Mandatory PKCE S256 (`plain` method rejected). Ephemeral authorization codes bound to registered `client_id` and `redirect_uri` with 5-minute TTL. `state` parameter verified. |
| **Token Theft & Replay** | Bearer tokens stolen from transit or storage. | High-entropy opaque tokens stored strictly as SHA-256 hashes on disk. Access tokens expire in 1 hour. Refresh tokens rotate on every invocation; replaying a previously used refresh token revokes the entire token family. |
| **Directory Traversal (`../`)** | Attacker passes `../../etc/passwd` to `read_file` or `search_workspace`. | Deepest-ancestor canonical realpath resolution (`fs.realpathSync`). Resolved target path must strictly start with the canonical workspace root. |
| **Symlink Escape** | A symlink inside the workspace points to `/` or `~/.ssh`. | Symlinks are resolved to their target canonical realpath before boundary checks. Any symlink target pointing outside the workspace root is rejected with `PATH_OUTSIDE_WORKSPACE`. |
| **Windows NTFS ADS (`::$DATA`)** | Attacker appends `::$DATA` or `:stream` to bypass pattern filters on Windows. | Path validation explicitly checks for and rejects colons (`:`) in relative paths and blocks Windows Alternate Data Stream identifiers (`::$DATA`). |
| **Windows Trailing Dot / Space** | Attacker requests `.env.` or `.env ` which Windows filesystem normalizes to `.env`. | Paths ending with trailing dots (`.`) or trailing whitespace are normalized and rejected before filesystem access. |
| **Case Sensitivity Bypass** | Attacker requests `.ENV` or `Id_Rsa` on case-insensitive filesystems (Windows/macOS). | Case-insensitive matching is enforced for all sensitive and noise patterns across Windows, macOS, and Linux. |
| **Git Metadata & Config Leakage** | Attacker requests `.git/config` to extract tokens or remote repo credentials. | `.git/` and `.git/**` are placed directly in `SENSITIVE_PATTERNS`. Direct file reads of git internal metadata are rejected with `ACCESS_DENIED_SENSITIVE_FILE`. |
| **Sensitive Credential Leakage** | Tool requests access to `.env`, private keys, SSH keys, or cloud credentials. | Deny-by-default filter blocks `.env*` (allowing `.env.example`), `*.pem`, `*.key`, `id_rsa*`, `.aws/`, `.ssh/`, `kubeconfig`, `.docker/config.json`, `.c2cignore`. |
| **Log Credential Exfiltration** | Sanitized test/build outputs containing API keys are requested via `execution_output`. | Modern API key regex redactor automatically scrubs OpenAI project keys (`sk-proj-...`), Anthropic keys (`sk-ant-...`), Google API keys (`AIza...`), bearer tokens, and user home paths. Private key blocks are denied completely. |
| **Local Port Hijacking** | Local malware attempts to call the bridge daemon API directly. | Loopback-only binding (`127.0.0.1`). Admin endpoints require a high-entropy random token stored in an OS-protected runtime state file (0600 permissions). Proxy headers (`X-Forwarded-For`) from loopback callers are sanitized. |

---

## 3. Sensitive File Policy (`SENSITIVE_PATTERNS`)

Direct file reading, workspace searches, and directory listings enforce strict exclusions. The following patterns are denied by default with `ACCESS_DENIED_SENSITIVE_FILE`:

```typescript
export const SENSITIVE_PATTERNS: string[] = [
  ".env",
  ".env.*",
  "!.env.example",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "id_rsa*",
  "id_ed25519*",
  "id_ecdsa*",
  "id_dsa*",
  ".ssh/",
  ".aws/",
  ".gnupg/",
  ".npmrc",
  ".netrc",
  "_netrc",
  ".git/",
  ".git/**",
  ".git-credentials",
  "*.keychain*",
  ".cloudflared/",
  "credentials.json",
  "service-account*.json",
  "client_secret*.json",
  "secrets.json",
  "cookies.sqlite",
  "Cookies",
  ".envrc",
  "kubeconfig",
  ".kube/",
  ".docker/config.json",
  "*.ppk",
  ".vault-token",
  ".c2c-secrets*"
];
```

Users can define additional workspace-specific rules by adding a `.c2cignore` file to the root of their workspace.

---

## 4. Redaction Engine for Execution Records

When Claude Code records build or test outputs (`c2c record --command "pnpm test" --output-file /tmp/test.log`), the execution sanitizer scrubs content before storing it in `execution_output`:

1. **Private Key Interception**: Any block matching `-----BEGIN [A-Z ]*PRIVATE KEY-----` immediately marks the entire output as `RESTRICTED` (omitting the body from MCP access).
2. **Modern API Key Redaction**:
   - OpenAI Legacy & Project Keys: `sk-[a-zA-Z0-9]{20,T3BlbkFJ[a-zA-Z0-9]{20,}`, `sk-proj-[a-zA-Z0-9_-]{20,}`
   - Anthropic Keys: `sk-ant-api[0-9]{2}-[a-zA-Z0-9_-]{20,}`
   - Google API Keys: `AIza[0-9A-Za-z-_]{35}`
   - Generic Bearer Headers: `Bearer [a-zA-Z0-9_.-]+`
3. **Filesystem Path Scrubbing**: User home directory roots (`/Users/username`, `C:\Users\username`, `/home/username`) are replaced with generic placeholders `~`.
4. **Size and Line Caps**: Outputs exceeding line or byte limits (e.g. 500 lines / 64 KB) are safely truncated with clear truncation markers.

---

## 5. Storage Security & File Permissions

All bridge state, client registrations, and token hashes reside in standard OS-level application directories:
- **macOS**: `~/Library/Application Support/claude-code-with-chatgpt`
- **Windows**: `%LOCALAPPDATA%\claude-code-with-chatgpt`
- **Linux**: `$XDG_STATE_HOME/claude-code-with-chatgpt` (or `~/.local/state/claude-code-with-chatgpt`)

Directory permissions are set to `0700` and sensitive files are set to `0600`. Tokens are stored exclusively as cryptographic SHA-256 digests; raw tokens are never written to disk.

---

## 6. Execution Sandboxing & OS Containment Realities

Claude Code provides application-level tool permission enforcement (`permissions.allow`, `permissions.ask`, `permissions.deny`) across all supported platforms. However, low-level OS process and filesystem containment differs by operating system:

1. **macOS & Linux**: Native OS sandboxing is powered by Seatbelt (macOS) and Bubblewrap/namespaces (Linux). Claude Code enforces `sandbox.filesystem.allowWrite` at the kernel/process containment layer.
2. **Native Windows**: OS-level namespace sandboxing (Bubblewrap/Seatbelt) does **not** run on native Win32. 
   - Application-level tool permissions (e.g. `Bash(...)`, `FileRead(...)`) remain 100% enforced by the Claude Code harness.
   - Filesystem write boundaries (`sandbox.filesystem.allowWrite`) configure Claude Code's internal execution policies.
   - For users requiring kernel-isolated process containment on Windows machines, running Claude Code and the C2C Bridge inside **WSL2 (Windows Subsystem for Linux)** is recommended.
