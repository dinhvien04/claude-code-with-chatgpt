import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
 * Minimal Claude Code required permissions for normal collaboration loop.
 * Only includes commands genuinely needed for standard operation.
 * Explicitly excludes:
 * - Local node scripts (e.g. `node bin/c2c.js ...` - untrusted in arbitrary workspaces)
 * - Sensitive token revocation (`c2c unpair`)
 * - Settings mutation (`c2c config-allow`, `c2c sandbox-allow`)
 * - Configuration/provisioning commands (`c2c tunnel`, `c2c prefs`, `c2c workspace`, `c2c update-check`)
 * - Abrupt process kills (`c2c stop`, `c2c restart`)
 */
export const REQUIRED_C2C_SUBCOMMANDS = [
  "setup",
  "doctor",
  "start",
  "status",
  "pair",
  "session",
  "record",
  "logs",
  "bundle",
] as const;

export const REQUIRED_PERMISSIONS: string[] = [
  ...REQUIRED_C2C_SUBCOMMANDS.map((sub) => `Bash(c2c ${sub} *)`),
];

export function isCaseInsensitive(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
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

export class GitExcludeError extends Error {
  constructor(public readonly workspaceRoot: string, public readonly cause: unknown) {
    super(
      `Failed to configure Git exclude for workspace at ${workspaceRoot}: ` +
        `Cannot safely ignore .claude/settings.local.json in Git metadata. ` +
        `Aborting operation to prevent committing machine-specific settings. Details: ${
          cause instanceof Error ? cause.message : String(cause)
        }`
    );
    this.name = "GitExcludeError";
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
 * Returns the path to the repository's info/exclude file using Git itself.
 * Uses `git rev-parse --git-path info/exclude` to accurately locate $GIT_COMMON_DIR/info/exclude
 * across standard repositories, linked worktrees, and custom gitdirs.
 * Throws an error if git command fails.
 */
export function getGitExcludePath(workspaceRoot: string): string {
  const raw = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(workspaceRoot)),
    },
    timeout: 3000,
  }).trim();

  if (!raw) {
    throw new Error("Git returned an empty path for info/exclude");
  }
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(workspaceRoot, raw);
}

/**
 * Ensures .claude/settings.local.json is properly ignored:
 * - If workspace is a Git repository or Git worktree (has a .git directory or worktree .git pointer),
 *   queries Git for `--git-path info/exclude` and appends the rule without dirtying the tracked `.gitignore`.
 * - If Git exclude configuration fails in a Git workspace, throws GitExcludeError (Fail-Closed).
 * - If non-Git directory, writes to workspace .gitignore as safe fallback.
 */
export function ensureIgnoreLocalSettings(workspaceRoot: string): void {
  const targetRule = ".claude/settings.local.json";
  const gitMarker = path.join(workspaceRoot, ".git");
  const inGitRepo = fs.existsSync(gitMarker);

  if (inGitRepo) {
    try {
      const excludePath = getGitExcludePath(workspaceRoot);
      const infoDir = path.dirname(excludePath);
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
        const addition =
          content.length === 0 || content.endsWith("\n")
            ? `${targetRule}\n`
            : `\n${targetRule}\n`;
        fs.appendFileSync(excludePath, addition, "utf8");
      }
      return;
    } catch (err) {
      throw new GitExcludeError(workspaceRoot, err);
    }
  }

  // Fallback for non-Git workspaces
  try {
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
      const addition =
        content.length === 0 || content.endsWith("\n")
          ? `${targetRule}\n`
          : `\n${targetRule}\n`;
      fs.appendFileSync(gitignorePath, addition, "utf8");
    }
  } catch {
    // Best-effort workspace ignore update for non-git
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
