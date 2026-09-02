import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * State directory resolution, following OS conventions.
 * Primary state directory for Claude Code with ChatGPT is 'claude-code-with-chatgpt'.
 * Override with C2C_STATE_DIR (used heavily by tests).
 */
export function getStateDir(): string {
  const override = process.env.C2C_STATE_DIR;
  if (override && override.trim() !== "") return path.resolve(override);
  const home = os.homedir();

  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "claude-code-with-chatgpt");
    case "win32": {
      const localApp = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
      return path.join(localApp, "claude-code-with-chatgpt");
    }
    default: {
      const base = process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state");
      return path.join(base, "claude-code-with-chatgpt");
    }
  }
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Write a JSON file with owner-only permissions and atomic replacement. */
export function writeSecureJson(file: string, data: unknown): void {
  const dir = ensureDir(path.dirname(file));
  const tempFile = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  );
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(tempFile, 0o600);
  } catch {
    // best effort on platforms without chmod semantics
  }
  try {
    fs.renameSync(tempFile, file);
  } catch {
    // Fallback if cross-device or Windows locked rename occurs
    try {
      fs.copyFileSync(tempFile, file);
      fs.unlinkSync(tempFile);
    } catch {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
      try {
        fs.unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
    }
  }
}

export function readJsonIfExists<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export const DEFAULT_PORT = 48765;
export const DEFAULT_HOST = "127.0.0.1";
