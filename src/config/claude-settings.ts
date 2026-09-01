import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getStateDir } from "./paths.js";

export interface ClaudeConfigAllowResult {
  added: boolean;
  alreadyAllowed: boolean;
  stateDir: string;
  configPath: string;
  scope: "workspace" | "global";
}

export interface ClaudeSettings {
  $schema?: string;
  permissions?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
    defaultMode?: string;
    additionalDirectories?: string[];
    [key: string]: unknown;
  };
  sandbox?: {
    enabled?: boolean;
    filesystem?: {
      allowWrite?: string[];
      denyWrite?: string[];
      allowRead?: string[];
      denyRead?: string[];
      [key: string]: unknown;
    };
    network?: {
      allowedDomains?: string[];
      deniedDomains?: string[];
      allowLocalBinding?: boolean;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Normal Claude Code required permissions.
 * Explicitly excludes legacy and admin commands (e.g. `c2c sandbox-allow` and `c2c config-allow`)
 * as well as sensitive token-revocation commands (e.g. `c2c unpair`).
 */
export const REQUIRED_C2C_SUBCOMMANDS = [
  "setup",
  "doctor",
  "start",
  "stop",
  "restart",
  "status",
  "pair",
  "session",
  "record",
  "tunnel",
  "prefs",
  "logs",
  "workspace",
  "update-check",
] as const;

export const REQUIRED_PERMISSIONS: string[] = [
  ...REQUIRED_C2C_SUBCOMMANDS.map((sub) => `Bash(c2c ${sub} *)`),
  ...REQUIRED_C2C_SUBCOMMANDS.map((sub) => `Bash(node bin/c2c.js ${sub} *)`),
];

export function isCaseInsensitive(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" || platform === "darwin";
}

export function normPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = p.replace(/\\/g, "/").normalize("NFC");
  const trimmed = normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  return isCaseInsensitive(platform) ? trimmed.toLowerCase() : trimmed;
}

export class MalformedSettingsError extends Error {
  constructor(public readonly filePath: string, public readonly cause: unknown) {
    super(
      `Cannot read Claude settings at ${filePath}: File exists but contains invalid JSON or cannot be parsed. ` +
        `Aborting operation to prevent overwriting user configuration. Details: ${
          cause instanceof Error ? cause.message : String(cause)
        }`
    );
    this.name = "MalformedSettingsError";
  }
}

/**
 * Returns the path to the settings file depending on scope:
 * - workspace default: .claude/settings.local.json (preserves machine-specific paths from git)
 * - global: ~/.claude/settings.json
 */
export function getClaudeSettingsPath(workspaceRoot?: string, global = false, local = true): string {
  if (!global && workspaceRoot) {
    const filename = local ? "settings.local.json" : "settings.json";
    return path.join(path.resolve(workspaceRoot), ".claude", filename);
  }
  return path.join(os.homedir(), ".claude", "settings.json");
}

/**
 * Reads and parses a Claude settings file with strict fail-closed behavior.
 * - Non-existent file => returns empty object `{}`
 * - Empty/whitespace-only file => returns empty object `{}`
 * - Malformed / invalid JSON => throws `MalformedSettingsError` without modifying anything.
 */
export function readClaudeSettings(configPath: string): ClaudeSettings {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    throw new MalformedSettingsError(configPath, err);
  }

  if (raw.trim() === "") {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Settings root must be a JSON object");
    }
    return parsed as ClaudeSettings;
  } catch (err) {
    throw new MalformedSettingsError(configPath, err);
  }
}

/**
 * Writes Claude settings atomically to disk with mode 0o600 and directory 0o700.
 */
export function writeClaudeSettingsAtomic(configPath: string, settings: ClaudeSettings): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best-effort on platforms without chmod semantics
  }

  const payload = JSON.stringify(settings, null, 2) + "\n";
  const tempPath = path.join(
    dir,
    `.tmp.${path.basename(configPath)}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}`
  );

  let fd: number | null = null;
  try {
    fd = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, payload, { encoding: "utf8" });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    fs.renameSync(tempPath, configPath);
    try {
      fs.chmodSync(configPath, 0o600);
    } catch {
      // Best-effort on Windows
    }
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close error during cleanup
      }
    }
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Ignore temp cleanup error
    }
    throw err;
  }
}

/**
 * Finds the actual .git directory (resolves standard directories and worktrees with `gitdir:` pointers).
 */
export function findGitDir(workspaceRoot: string): string | null {
  try {
    const gitPath = path.join(workspaceRoot, ".git");
    if (!fs.existsSync(gitPath)) return null;
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) return gitPath;
    if (stat.isFile()) {
      const content = fs.readFileSync(gitPath, "utf8");
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (match && match[1]) {
        const raw = match[1].trim();
        return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(workspaceRoot, raw);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ensures .claude/settings.local.json is properly ignored:
 * - If workspace is a Git repository or Git worktree, appends to .git/info/exclude (preserves .gitignore cleanliness).
 * - If not a Git repository, creates or appends to workspace .gitignore safely.
 */
export function ensureIgnoreLocalSettings(workspaceRoot: string): void {
  const targetRule = ".claude/settings.local.json";
  try {
    const gitDir = findGitDir(workspaceRoot);
    if (gitDir && fs.existsSync(gitDir)) {
      const infoDir = path.join(gitDir, "info");
      const excludePath = path.join(infoDir, "exclude");
      fs.mkdirSync(infoDir, { recursive: true });

      let content = "";
      if (fs.existsSync(excludePath)) {
        content = fs.readFileSync(excludePath, "utf8");
      }
      const lines = content.split(/\r?\n/);
      const hasRule = lines.some((l) => {
        const trimmed = l.trim();
        return (
          trimmed === targetRule ||
          trimmed === "/.claude/settings.local.json" ||
          trimmed === "settings.local.json" ||
          trimmed === ".claude/*.local.json"
        );
      });
      if (!hasRule) {
        const addition = content.length === 0 || content.endsWith("\n")
          ? `${targetRule}\n`
          : `\n${targetRule}\n`;
        fs.appendFileSync(excludePath, addition, "utf8");
      }
      return;
    }

    // Fallback for non-git workspace: ensure in workspace .gitignore
    const gitignorePath = path.join(workspaceRoot, ".gitignore");
    let content = "";
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, "utf8");
    }
    const lines = content.split(/\r?\n/);
    const hasRule = lines.some((l) => {
      const trimmed = l.trim();
      return (
        trimmed === targetRule ||
        trimmed === "/.claude/settings.local.json" ||
        trimmed === "settings.local.json" ||
        trimmed === ".claude/*.local.json"
      );
    });
    if (!hasRule) {
      const addition = content.length === 0 || content.endsWith("\n")
        ? `${targetRule}\n`
        : `\n${targetRule}\n`;
      fs.appendFileSync(gitignorePath, addition, "utf8");
    }
  } catch {
    // Best-effort workspace ignore update
  }
}

/**
 * Idempotently and safely configures Claude Code permissions and sandbox write access.
 * - Machine-specific absolute state directories are placed in .claude/settings.local.json (workspace)
 *   or ~/.claude/settings.json (global), keeping git-tracked files clean.
 * - Minimal permissions are granted; legacy `c2c sandbox-allow` and sensitive `c2c unpair` are NEVER auto-approved.
 * - Malformed settings fail closed and are never overwritten.
 * - Writes are atomic.
 */
export function ensureClaudeConfigAllow(opts?: {
  workspaceRoot?: string;
  configPath?: string;
  stateDir?: string;
  global?: boolean;
}): ClaudeConfigAllowResult {
  const stateDir = path.resolve(opts?.stateDir ?? getStateDir());
  const isGlobal = opts?.global ?? false;
  const configPath =
    opts?.configPath ?? getClaudeSettingsPath(opts?.workspaceRoot, isGlobal, true);
  const scope: "workspace" | "global" = isGlobal || !opts?.workspaceRoot ? "global" : "workspace";

  if (opts?.workspaceRoot && !isGlobal && !opts?.configPath) {
    ensureIgnoreLocalSettings(opts.workspaceRoot);
  }

  // Fail-closed read
  const settings = readClaudeSettings(configPath);

  // Preserve existing permissions object and sub-arrays
  const existingPermissions = Array.isArray(settings.permissions?.allow)
    ? [...settings.permissions.allow]
    : [];

  const existingSandboxAllowWrite = Array.isArray(settings.sandbox?.filesystem?.allowWrite)
    ? [...settings.sandbox.filesystem.allowWrite]
    : [];

  let modified = false;

  // 1. Merge minimal required permissions
  const nextPermissions = [...existingPermissions];
  for (const perm of REQUIRED_PERMISSIONS) {
    if (!nextPermissions.includes(perm)) {
      nextPermissions.push(perm);
      modified = true;
    }
  }

  // 2. Merge sandbox.filesystem.allowWrite for the state directory using platform-aware normPath
  const targetNormStateDir = normPath(stateDir);
  const normalizedStateDirForWrite = stateDir.replace(/\\/g, "/").normalize("NFC");
  const nextSandboxAllowWrite = [...existingSandboxAllowWrite];
  const hasStateDir = nextSandboxAllowWrite.some(
    (root) => normPath(root) === targetNormStateDir
  );

  if (!hasStateDir) {
    nextSandboxAllowWrite.push(normalizedStateDirForWrite);
    modified = true;
  }

  // Check if legacy invented writableRoots is present; if so, remove it cleanly
  if ("writableRoots" in settings) {
    delete settings.writableRoots;
    modified = true;
  }

  if (!modified && fs.existsSync(configPath)) {
    return {
      added: false,
      alreadyAllowed: true,
      stateDir,
      configPath,
      scope,
    };
  }

  const nextSettings: ClaudeSettings = {
    ...settings,
    permissions: {
      ...settings.permissions,
      allow: nextPermissions,
    },
    sandbox: {
      ...settings.sandbox,
      filesystem: {
        ...settings.sandbox?.filesystem,
        allowWrite: nextSandboxAllowWrite,
      },
    },
  };

  // Atomic write
  writeClaudeSettingsAtomic(configPath, nextSettings);

  return {
    added: true,
    alreadyAllowed: false,
    stateDir,
    configPath,
    scope,
  };
}
