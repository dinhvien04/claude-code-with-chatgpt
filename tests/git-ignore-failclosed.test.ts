import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ensureClaudeConfigAllow,
  ensureIgnoreLocalSettings,
  GitExcludeError,
} from "../src/config/claude-settings.js";
import { makeTmpDir, cleanup } from "./helpers.js";

describe("Git Ignore Fail-Closed Invariants", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("git-failclosed-test");
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it("fails closed when Git exclude metadata cannot be written (EACCES / Read-Only)", () => {
    const repo = path.join(tmpDir, "ro-repo");
    fs.mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });

    const infoDir = path.join(repo, ".git", "info");
    fs.mkdirSync(infoDir, { recursive: true });
    const excludeFile = path.join(infoDir, "exclude");
    fs.writeFileSync(excludeFile, "# existing\n", { mode: 0o444 });

    const localSettingsPath = path.join(repo, ".claude", "settings.local.json");

    // Mock append failure
    const origAppend = fs.appendFileSync;
    fs.appendFileSync = () => {
      const err = new Error("EACCES: permission denied, open 'info/exclude'") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    };

    try {
      expect(() => {
        ensureClaudeConfigAllow({ workspaceRoot: repo });
      }).toThrow(GitExcludeError);

      // SECURITY INVARIANT: Settings file must NEVER be created on ignore failure
      expect(fs.existsSync(localSettingsPath)).toBe(false);
      // No untracked .gitignore fallback created in git repo
      expect(fs.existsSync(path.join(repo, ".gitignore"))).toBe(false);
    } finally {
      fs.appendFileSync = origAppend;
    }
  });

  it("fails closed on corrupt git repository without writing settings.local.json", () => {
    const corruptRepo = path.join(tmpDir, "corrupt-repo");
    fs.mkdirSync(path.join(corruptRepo, ".git"), { recursive: true });
    // Write corrupt git config
    fs.writeFileSync(path.join(corruptRepo, ".git", "config"), "INVALID_GIT_CONFIG", "utf8");

    const localSettingsPath = path.join(corruptRepo, ".claude", "settings.local.json");

    expect(() => {
      ensureClaudeConfigAllow({ workspaceRoot: corruptRepo });
    }).toThrow(GitExcludeError);

    expect(fs.existsSync(localSettingsPath)).toBe(false);
  });

  it("safely handles clean non-git workspaces with .gitignore fallback", () => {
    const nonGitDir = path.join(tmpDir, "pure-non-git");
    fs.mkdirSync(nonGitDir, { recursive: true });

    const result = ensureClaudeConfigAllow({ workspaceRoot: nonGitDir });
    expect(result.added).toBe(true);

    const gitignorePath = path.join(nonGitDir, ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(true);
    expect(fs.readFileSync(gitignorePath, "utf8")).toContain(".claude/settings.local.json");
  });
});
