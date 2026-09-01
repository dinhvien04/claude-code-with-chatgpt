import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getStateDir } from "./paths.js";

export interface ClaudeConfigAllowResult {
  added: boolean;
  alreadyAllowed: boolean;
  stateDir: string;
  configPath: string;
  scope: "workspace" | "global";
}

/**
 * Returns the path to the workspace or global Claude Code settings file.
 */
export function getClaudeSettingsPath(workspaceRoot?: string, global = false): string {
  if (!global && workspaceRoot) {
    return path.join(path.resolve(workspaceRoot), ".claude", "settings.json");
  }
  return path.join(os.homedir(), ".claude", "settings.json");
}

interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    [key: string]: unknown;
  };
  writableRoots?: string[];
  [key: string]: unknown;
}

/**
 * Idempotently adds c2c CLI permissions and stateDir to .claude/settings.json
 */
export function ensureClaudeConfigAllow(opts?: {
  workspaceRoot?: string;
  configPath?: string;
  stateDir?: string;
  global?: boolean;
}): ClaudeConfigAllowResult {
  const stateDir = path.resolve(opts?.stateDir ?? getStateDir());
  const configPath =
    opts?.configPath ?? getClaudeSettingsPath(opts?.workspaceRoot, opts?.global ?? false);
  const scope: "workspace" | "global" =
    opts?.global || !opts?.workspaceRoot ? "global" : "workspace";

  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });

  let settings: ClaudeSettings = {};
  if (fs.existsSync(configPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(configPath, "utf8")) as ClaudeSettings;
    } catch {
      settings = {};
    }
  }

  const existingPermissions = Array.isArray(settings.permissions?.allow)
    ? [...settings.permissions.allow]
    : [];
  const existingWritableRoots = Array.isArray(settings.writableRoots)
    ? [...settings.writableRoots]
    : [];

  const requiredPermissions = ["Bash(c2c *)", "Bash(c2c)"];
  let modified = false;

  const nextPermissions = [...existingPermissions];
  for (const perm of requiredPermissions) {
    if (!nextPermissions.includes(perm)) {
      nextPermissions.push(perm);
      modified = true;
    }
  }

  const normalizedStateDir = stateDir.replace(/\\/g, "/");
  const nextWritableRoots = [...existingWritableRoots];
  const hasStateDir = nextWritableRoots.some(
    (root) => root.replace(/\\/g, "/").toLowerCase() === normalizedStateDir.toLowerCase()
  );
  if (!hasStateDir) {
    nextWritableRoots.push(normalizedStateDir);
    modified = true;
  }

  if (!modified) {
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
    writableRoots: nextWritableRoots,
  };

  fs.writeFileSync(configPath, JSON.stringify(nextSettings, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });

  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Windows / best-effort
  }

  return {
    added: true,
    alreadyAllowed: false,
    stateDir,
    configPath,
    scope,
  };
}
