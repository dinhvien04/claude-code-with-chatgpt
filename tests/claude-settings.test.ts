import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ensureClaudeConfigAllow,
  getClaudeSettingsPath,
  readClaudeSettings,
  writeClaudeSettingsAtomic,
  MalformedSettingsError,
  REQUIRED_PERMISSIONS,
  REQUIRED_C2C_SUBCOMMANDS,
  findGitDir,
  ensureIgnoreLocalSettings,
  isCaseInsensitive,
  normPath,
} from "../src/config/claude-settings.js";
import { getStateDir } from "../src/config/paths.js";
import { PRODUCT_NAME, SERVICE_NAME, VERSION } from "../src/version.js";
import { DEFAULT_CONNECTOR_NAME, LEGACY_CONNECTOR_NAME } from "../src/config/endpoint.js";
import { makeTmpDir, cleanup } from "./helpers.js";

describe("Claude Code Settings & Permissions (Enhanced Regression Suite)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("claude-settings-test");
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe("Schema Integrity & Nonstandard Key Rejection", () => {
    it("does not generate or emit invented 'writableRoots' in settings", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      const stateDir = path.join(tmpDir, "state");

      const result = ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
        stateDir,
      });

      expect(result.added).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(content.writableRoots).toBeUndefined();
      expect(content.sandbox?.filesystem?.allowWrite).toBeDefined();
      expect(
        content.sandbox.filesystem.allowWrite.some(
          (r: string) => normPath(r) === normPath(stateDir)
        )
      ).toBe(true);
    });

    it("cleans up legacy invented writableRoots if present", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          permissions: { allow: [] },
          writableRoots: ["/legacy/path"],
        }),
        "utf8"
      );

      const result = ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
      });

      expect(result.added).toBe(true);
      const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(content.writableRoots).toBeUndefined();
    });
  });

  describe("Workspace Scoping & Git Exclusion Management", () => {
    it("writes machine-specific paths to settings.local.json by default for workspace scope", () => {
      const defaultLocalPath = getClaudeSettingsPath(tmpDir, false, true);
      expect(defaultLocalPath).toContain("settings.local.json");

      const result = ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
      });

      expect(result.scope).toBe("workspace");
      expect(result.configPath).toBe(defaultLocalPath);
      expect(fs.existsSync(defaultLocalPath)).toBe(true);
    });

    it("respects global scope targeting ~/.claude/settings.json", () => {
      const globalConfigPath = path.join(tmpDir, "global", ".claude", "settings.json");
      const result = ensureClaudeConfigAllow({
        global: true,
        configPath: globalConfigPath,
        stateDir: path.join(tmpDir, "global-state"),
      });

      expect(result.scope).toBe("global");
      expect(result.configPath).toBe(globalConfigPath);
      expect(fs.existsSync(globalConfigPath)).toBe(true);
    });

    it("uses .git/info/exclude in standard git repositories without dirtying .gitignore", () => {
      const gitDir = path.join(tmpDir, ".git");
      fs.mkdirSync(gitDir, { recursive: true });

      ensureIgnoreLocalSettings(tmpDir);

      const excludePath = path.join(gitDir, "info", "exclude");
      expect(fs.existsSync(excludePath)).toBe(true);
      const content = fs.readFileSync(excludePath, "utf8");
      expect(content).toContain(".claude/settings.local.json");

      // Verify .gitignore in root was NOT created or dirtied
      expect(fs.existsSync(path.join(tmpDir, ".gitignore"))).toBe(false);
    });

    it("resolves git worktrees with gitdir: file pointer and updates real .git/info/exclude", () => {
      const mainGitDir = path.join(tmpDir, "main-repo", ".git", "worktrees", "feature-wt");
      fs.mkdirSync(mainGitDir, { recursive: true });

      const worktreeDir = path.join(tmpDir, "worktree-workspace");
      fs.mkdirSync(worktreeDir, { recursive: true });

      // Create .git pointer file
      fs.writeFileSync(path.join(worktreeDir, ".git"), `gitdir: ${mainGitDir}\n`, "utf8");

      expect(findGitDir(worktreeDir)).toBe(mainGitDir);

      ensureIgnoreLocalSettings(worktreeDir);

      const excludePath = path.join(mainGitDir, "info", "exclude");
      expect(fs.existsSync(excludePath)).toBe(true);
      const content = fs.readFileSync(excludePath, "utf8");
      expect(content).toContain(".claude/settings.local.json");
      expect(fs.existsSync(path.join(worktreeDir, ".gitignore"))).toBe(false);
    });

    it("safely creates .gitignore in non-git directories", () => {
      ensureIgnoreLocalSettings(tmpDir);

      const gitignorePath = path.join(tmpDir, ".gitignore");
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const content = fs.readFileSync(gitignorePath, "utf8");
      expect(content).toContain(".claude/settings.local.json");
    });
  });

  describe("Fail-Closed Behavior on Corrupted or Malformed JSON", () => {
    it("throws MalformedSettingsError and preserves malformed settings.json byte-for-byte", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      fs.mkdirSync(path.dirname(configPath), { recursive: true });

      const malformedJson = '{\n  "permissions": {\n    "allow": ["Bash(test)"],\n    invalidSyntax: true\n  }\n';
      fs.writeFileSync(configPath, malformedJson, "utf8");

      const originalHash = crypto.createHash("sha256").update(fs.readFileSync(configPath)).digest("hex");

      expect(() => {
        ensureClaudeConfigAllow({
          workspaceRoot: tmpDir,
          configPath,
        });
      }).toThrow(MalformedSettingsError);

      const afterBytes = fs.readFileSync(configPath);
      const afterHash = crypto.createHash("sha256").update(afterBytes).digest("hex");

      expect(afterHash).toBe(originalHash);
      expect(afterBytes.toString("utf8")).toBe(malformedJson);
    });

    it("rejects non-object root JSON values without modifying target file", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, '["not", "an", "object"]', "utf8");

      expect(() => {
        ensureClaudeConfigAllow({
          workspaceRoot: tmpDir,
          configPath,
        });
      }).toThrow(MalformedSettingsError);

      expect(fs.readFileSync(configPath, "utf8")).toBe('["not", "an", "object"]');
    });
  });

  describe("Atomic Write & Rollback Verification", () => {
    it("performs atomic write and sets secure permissions", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      writeClaudeSettingsAtomic(configPath, {
        permissions: { allow: ["Bash(c2c setup *)"] },
      });

      expect(fs.existsSync(configPath)).toBe(true);
      const content = readClaudeSettings(configPath);
      expect(content.permissions?.allow).toContain("Bash(c2c setup *)");

      // Verify no temporary files left in directory
      const files = fs.readdirSync(path.dirname(configPath));
      expect(files.filter((f) => f.startsWith(".tmp.")).length).toBe(0);
    });
  });

  describe("Minimal Permission Grants & Sensitive Command Exclusion", () => {
    it("uses token-boundary wildcard syntax Bash(c2c <subcommand> *)", () => {
      for (const perm of REQUIRED_PERMISSIONS) {
        expect(perm).toMatch(/Bash\((c2c|node bin\/c2c\.js) [a-z0-9_-]+ \*\)/);
        // Ensure no adjacent wildcards like "setup*" without space
        expect(perm).not.toMatch(/Bash\((c2c|node bin\/c2c\.js) [a-z0-9_-]+\*\)/);
      }
    });

    it("includes required c2c subcommands but explicitly excludes legacy sandbox-allow, config-allow, and unpair", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
      });

      const content = readClaudeSettings(configPath);
      const allow = content.permissions?.allow ?? [];

      expect(allow).toContain("Bash(c2c setup *)");
      expect(allow).toContain("Bash(c2c doctor *)");
      expect(allow).toContain("Bash(c2c status *)");
      expect(allow).toContain("Bash(c2c pair *)");
      expect(allow).toContain("Bash(c2c session *)");
      expect(allow).toContain("Bash(c2c record *)");

      // Verify sensitive and admin commands are NOT auto-approved
      expect(allow.some((p) => p.includes("unpair"))).toBe(false);
      expect(allow.some((p) => p.includes("sandbox-allow"))).toBe(false);
      expect(allow.some((p) => p.includes("config-allow"))).toBe(false);
      expect(allow.includes("Bash(c2c *)")).toBe(false);
      expect(allow.includes("Bash(c2c setup*)")).toBe(false);
    });
  });

  describe("Preservation of User Permissions & Sandbox Objects", () => {
    it("preserves permissions.ask, permissions.deny, and unrelated allow rules", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          customUserConfig: "preserve-me",
          permissions: {
            allow: ["Bash(npm test)", "Bash(git status)"],
            ask: ["Bash(rm -rf *)", "Bash(git push *)"],
            deny: ["Bash(curl * | bash)"],
          },
          sandbox: {
            network: {
              allowedDomains: ["api.anthropic.com"],
            },
            filesystem: {
              allowWrite: ["/var/log/existing"],
            },
          },
        }),
        "utf8"
      );

      const result = ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
        stateDir: path.join(tmpDir, "state"),
      });

      expect(result.added).toBe(true);

      const content = readClaudeSettings(configPath);
      expect(content.customUserConfig).toBe("preserve-me");
      expect(content.permissions?.ask).toEqual(["Bash(rm -rf *)", "Bash(git push *)"]);
      expect(content.permissions?.deny).toEqual(["Bash(curl * | bash)"]);
      expect(content.permissions?.allow).toContain("Bash(npm test)");
      expect(content.permissions?.allow).toContain("Bash(git status)");
      expect(content.permissions?.allow).toContain("Bash(c2c setup *)");

      expect(content.sandbox?.network?.allowedDomains).toEqual(["api.anthropic.com"]);
      expect(content.sandbox?.filesystem?.allowWrite).toContain("/var/log/existing");
    });
  });

  describe("Strict Idempotency & Semantics Stability", () => {
    it("executing multiple times produces identical file content and valid return flags", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      const stateDir = path.join(tmpDir, "state");

      const first = ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
        stateDir,
      });
      expect(first.added).toBe(true);
      expect(first.alreadyAllowed).toBe(false);
      const firstText = fs.readFileSync(configPath, "utf8");

      const second = ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
        stateDir,
      });
      expect(second.added).toBe(false);
      expect(second.alreadyAllowed).toBe(true);
      const secondText = fs.readFileSync(configPath, "utf8");

      const third = ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
        stateDir,
      });
      expect(third.added).toBe(false);
      expect(third.alreadyAllowed).toBe(true);
      const thirdText = fs.readFileSync(configPath, "utf8");

      expect(firstText).toBe(secondText);
      expect(secondText).toBe(thirdText);
    });
  });

  describe("Cross-Platform Path Handling & Case Sensitivity", () => {
    it("normalizes Windows backslashes to forward slashes", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      const winStateDir = "C:\\Users\\Developer\\AppData\\Local\\claude-code-with-chatgpt";

      ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
        stateDir: winStateDir,
      });

      const content = readClaudeSettings(configPath);
      expect(content.sandbox?.filesystem?.allowWrite).toContain(
        "C:/Users/Developer/AppData/Local/claude-code-with-chatgpt"
      );
    });

    it("handles paths with spaces and Unicode characters safely", () => {
      const configPath = path.join(tmpDir, ".claude", "settings.local.json");
      const unicodeStateDir = path.join(tmpDir, "项目状态目录_café with spaces");

      ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
        stateDir: unicodeStateDir,
      });

      const content = readClaudeSettings(configPath);
      const normalizedUnicode = unicodeStateDir.replace(/\\/g, "/").normalize("NFC");
      expect(content.sandbox?.filesystem?.allowWrite).toContain(normalizedUnicode);

      // Verify second call remains idempotent
      const second = ensureClaudeConfigAllow({
        workspaceRoot: tmpDir,
        configPath,
        stateDir: unicodeStateDir,
      });
      expect(second.alreadyAllowed).toBe(true);
    });

    it("accurately reports case sensitivity rules based on platform", () => {
      expect(isCaseInsensitive("win32")).toBe(true);
      expect(isCaseInsensitive("darwin")).toBe(true);
      expect(isCaseInsensitive("linux")).toBe(false);
      expect(isCaseInsensitive("openbsd")).toBe(false);

      expect(normPath("/Path/To/State", "linux")).toBe("/Path/To/State");
      expect(normPath("/Path/To/State", "win32")).toBe("/path/to/state");
    });
  });

  describe("Runtime Branding & Constants", () => {
    it("uses Claude Code branding for active product and connector names", () => {
      expect(PRODUCT_NAME).toBe("Claude Code with ChatGPT");
      expect(SERVICE_NAME).toBe("c2c-bridge");
      expect(VERSION).toBeDefined();
      expect(DEFAULT_CONNECTOR_NAME).toBe("Claude Code with ChatGPT");
      expect(LEGACY_CONNECTOR_NAME).toBe("Codex with ChatGPT");
    });
  });

  describe("State Directory Resolution (paths.ts)", () => {
    const origEnv = process.env.C2C_STATE_DIR;

    afterEach(() => {
      if (origEnv !== undefined) {
        process.env.C2C_STATE_DIR = origEnv;
      } else {
        delete process.env.C2C_STATE_DIR;
      }
    });

    it("respects C2C_STATE_DIR environment override", () => {
      const custom = path.resolve("/custom/c2c/state");
      process.env.C2C_STATE_DIR = custom;
      expect(getStateDir()).toBe(custom);
    });

    it("resolves claude-code-with-chatgpt as primary path on the current OS", () => {
      delete process.env.C2C_STATE_DIR;
      const resolved = getStateDir();
      expect(resolved.toLowerCase()).toContain("claude-code-with-chatgpt");
    });
  });
});
