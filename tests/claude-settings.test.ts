import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ensureClaudeConfigAllow, getClaudeSettingsPath } from "../src/config/claude-settings.js";
import { getStateDir } from "../src/config/paths.js";
import { PRODUCT_NAME, SERVICE_NAME, VERSION } from "../src/version.js";
import { DEFAULT_CONNECTOR_NAME, LEGACY_CONNECTOR_NAME } from "../src/config/endpoint.js";
import { makeTmpDir, cleanup } from "./helpers.js";

describe("Claude Code Settings & Permissions (config-allow)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("claude-settings-test");
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it("creates workspace .claude/settings.json with required permissions and writableRoots", () => {
    const configPath = path.join(tmpDir, ".claude", "settings.json");
    const stateDir = path.join(tmpDir, "state");

    const result = ensureClaudeConfigAllow({
      workspaceRoot: tmpDir,
      configPath,
      stateDir,
    });

    expect(result.added).toBe(true);
    expect(result.alreadyAllowed).toBe(false);
    expect(fs.existsSync(configPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(content.permissions?.allow).toContain("Bash(c2c *)");
    expect(content.permissions?.allow).toContain("Bash(c2c)");
    expect(content.writableRoots).toBeDefined();
    expect(content.writableRoots.some((r: string) => r.toLowerCase() === stateDir.replace(/\\/g, "/").toLowerCase())).toBe(true);
  });

  it("is idempotent when permissions and stateDir are already present", () => {
    const configPath = path.join(tmpDir, ".claude", "settings.json");
    const stateDir = path.join(tmpDir, "state");

    const first = ensureClaudeConfigAllow({
      workspaceRoot: tmpDir,
      configPath,
      stateDir,
    });
    expect(first.added).toBe(true);

    const second = ensureClaudeConfigAllow({
      workspaceRoot: tmpDir,
      configPath,
      stateDir,
    });
    expect(second.added).toBe(false);
    expect(second.alreadyAllowed).toBe(true);
  });

  it("preserves existing custom settings when updating .claude/settings.json", () => {
    const configPath = path.join(tmpDir, ".claude", "settings.json");
    const stateDir = path.join(tmpDir, "state");

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        customKey: "customValue",
        permissions: { allow: ["Bash(git *)"], customPerm: true },
        writableRoots: ["/existing/path"],
      }),
      "utf8"
    );

    const result = ensureClaudeConfigAllow({
      workspaceRoot: tmpDir,
      configPath,
      stateDir,
    });

    expect(result.added).toBe(true);
    const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(content.customKey).toBe("customValue");
    expect(content.permissions.customPerm).toBe(true);
    expect(content.permissions.allow).toContain("Bash(git *)");
    expect(content.permissions.allow).toContain("Bash(c2c *)");
    expect(content.writableRoots).toContain("/existing/path");
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
