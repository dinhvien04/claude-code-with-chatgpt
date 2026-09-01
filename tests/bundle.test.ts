import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildPlanBundle,
  buildReviewBundle,
  buildDirectoryTree,
  buildFileSnippets,
  MAX_BUNDLE_BYTES,
  MAX_DIFF_BYTES,
  MAX_DIFF_LINES,
  MODE_P_PLAN_NOTICE,
} from "../src/bundle/index.js";
import { Workspace } from "../src/workspace/manager.js";
import { appendExecutionRecord } from "../src/execution/records.js";
import { saveExecutionOutput } from "../src/execution/output.js";
import { makeTmpDir, cleanup } from "./helpers.js";

describe("Mode P Bundle Generator Suite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("bundle-test");
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  describe("Directory Tree Generator (buildDirectoryTree)", () => {
    it("respects maxDepth and maxEntries limits", async () => {
      // Create nested directory structure
      const d1 = path.join(tmpDir, "src", "a", "b", "c", "d");
      fs.mkdirSync(d1, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "a", "b", "c", "d", "deep.ts"), "export const x = 1;");
      fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "console.log('hi');");

      const ws = new Workspace(tmpDir);
      const res = await buildDirectoryTree(ws, { maxDepth: 2, maxEntries: 50 });

      expect(res.formattedTree).toContain("src/");
      expect(res.formattedTree).toContain("index.ts");
      // Depth 2 stops at src/a/b and does not traverse into c/d
      expect(res.formattedTree).not.toContain("deep.ts");
    });

    it("truncates when exceeding maxEntries", async () => {
      for (let i = 0; i < 20; i++) {
        fs.writeFileSync(path.join(tmpDir, `file_${i}.txt`), `file ${i}`);
      }
      const ws = new Workspace(tmpDir);
      const res = await buildDirectoryTree(ws, { maxEntries: 10 });
      expect(res.entryCount).toBe(10);
      expect(res.truncated).toBe(true);
      expect(res.formattedTree).toContain("tree truncated at 10 entries");
    });
  });

  describe("File Snippets Builder (buildFileSnippets)", () => {
    it("safely loads allowed files and caps lines/bytes", async () => {
      const longContent = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`).join("\n");
      fs.writeFileSync(path.join(tmpDir, "large.ts"), longContent);
      fs.writeFileSync(path.join(tmpDir, "small.ts"), "const a = 1;");

      const ws = new Workspace(tmpDir);
      const res = await buildFileSnippets(ws, ["large.ts", "small.ts"], {
        maxFiles: 3,
        maxLinesPerFile: 50,
      });

      expect(res.filesIncluded).toEqual(["large.ts", "small.ts"]);
      expect(res.formattedSnippets).toContain("=== FILE: large.ts ===");
      expect(res.formattedSnippets).toContain("Line 50");
      expect(res.formattedSnippets).toContain("file content truncated at 50 lines");
      expect(res.formattedSnippets).toContain("=== FILE: small.ts ===");
    });

    it("strictly blocks sensitive files (.env, keys) from snippets", async () => {
      fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET_API_KEY=sk-1234567890");
      fs.writeFileSync(path.join(tmpDir, "id_rsa"), "PRIVATE KEY DATA");
      fs.writeFileSync(path.join(tmpDir, "safe.ts"), "export const safe = true;");

      const ws = new Workspace(tmpDir);
      const res = await buildFileSnippets(ws, [".env", "id_rsa", "safe.ts"]);

      expect(res.filesIncluded).toEqual(["safe.ts"]);
      expect(res.skippedFiles).toContain(".env");
      expect(res.skippedFiles).toContain("id_rsa");
      expect(res.formattedSnippets).not.toContain("SECRET_API_KEY");
      expect(res.formattedSnippets).not.toContain("PRIVATE KEY DATA");
    });

    it("redacts credentials and sensitive tokens inside source files", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "service.ts"),
        'const openai = "sk-proj-abcdef1234567890abcdef1234567890";\nconst anthropic = "sk-ant-api03-abcdef1234567890abcdef1234567890";'
      );

      const ws = new Workspace(tmpDir);
      const res = await buildFileSnippets(ws, ["service.ts"]);

      expect(res.formattedSnippets).toContain("[REDACTED]");
      expect(res.formattedSnippets).not.toContain("sk-proj-abcdef");
      expect(res.formattedSnippets).not.toContain("sk-ant-api03");
    });
  });

  describe("Plan Bundle Generator (buildPlanBundle)", () => {
    it("generates structured [C2C] STATE: INIT_P bundle under 48 KB", async () => {
      fs.writeFileSync(path.join(tmpDir, "main.ts"), "console.log('App starting');");

      const bundle = await buildPlanBundle({
        workspaceRoot: tmpDir,
        goal: "Implement user authentication with JWT",
        files: ["main.ts"],
      });

      expect(bundle.state).toBe("INIT_P");
      expect(bundle.taskId).toMatch(/^c2c_/);
      expect(bundle.iteration).toBe(0);
      expect(bundle.text).toContain("[C2C]");
      expect(bundle.text).toContain("STATE: INIT_P");
      expect(bundle.text).toContain("MODE: P (Plus Manual Context Handoff)");
      expect(bundle.text).toContain(MODE_P_PLAN_NOTICE);
      expect(bundle.text).toContain("GOAL:\nImplement user authentication with JWT");
      expect(bundle.text).toContain("BOUNDED_TREE:");
      expect(bundle.text).toContain("TARGET_SOURCE_SNIPPETS:");
      expect(bundle.text).toContain("=== FILE: main.ts ===");
      expect(bundle.sizeBytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
    });

    it("enforces hard budget limits and truncates oversized content", async () => {
      const hugeFile = Array.from({ length: 2000 }, () => "X".repeat(100)).join("\n");
      fs.writeFileSync(path.join(tmpDir, "huge.txt"), hugeFile);

      const bundle = await buildPlanBundle({
        workspaceRoot: tmpDir,
        goal: "Test oversized bundle",
        files: ["huge.txt"],
        maxTotalBytes: 5000,
      });

      expect(bundle.sizeBytes).toBeLessThanOrEqual(5050);
      expect(bundle.text).toContain("bundle truncated");
    });
  });

  describe("Review Bundle Generator (buildReviewBundle)", () => {
    it("generates [C2C] STATE: EXECUTED_P bundle with git diff and execution records", async () => {
      execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpDir, stdio: "ignore" });

      fs.writeFileSync(path.join(tmpDir, "src.ts"), "export const v1 = 1;");
      execFileSync("git", ["add", "src.ts"], { cwd: tmpDir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir, stdio: "ignore" });

      // Make changes
      fs.writeFileSync(path.join(tmpDir, "src.ts"), "export const v1 = 2; // modified");

      const ws = new Workspace(tmpDir);

      // Save execution output and record
      const output = saveExecutionOutput(ws.id, {
        command: "npm test",
        raw: "✓ 5 tests passed\nAll suites clean.",
        exitCode: 0,
        taskId: "c2c_rev1",
        iteration: 1,
      });

      appendExecutionRecord(ws.id, {
        taskId: "c2c_rev1",
        iteration: 1,
        changedFiles: ["src.ts"],
        tests: "5 passed, 0 failed",
        exitStatus: "ok",
        outputId: output.id,
        outputAvailable: true,
      });

      const bundle = await buildReviewBundle({
        workspaceRoot: tmpDir,
        taskId: "c2c_rev1",
        iteration: 1,
      });

      expect(bundle.state).toBe("EXECUTED_P");
      expect(bundle.taskId).toBe("c2c_rev1");
      expect(bundle.iteration).toBe(1);
      expect(bundle.text).toContain("[C2C]");
      expect(bundle.text).toContain("STATE: EXECUTED_P");
      expect(bundle.text).toContain(MODE_P_PLAN_NOTICE);
      expect(bundle.text).toContain("CHANGED_FILES:\n- src.ts");
      expect(bundle.text).toContain("SANITIZED_TESTS:\n5 passed, 0 failed");
      expect(bundle.text).toContain("SANITIZED_EXECUTION_OUTPUT:");
      expect(bundle.text).toContain("✓ 5 tests passed");
      expect(bundle.text).toContain("BOUNDED_GIT_DIFF:");
      expect(bundle.text).toContain("+export const v1 = 2; // modified");
      expect(bundle.sizeBytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
    });

    it("redacts credentials inside git diffs and command outputs", async () => {
      execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpDir, stdio: "ignore" });

      fs.writeFileSync(path.join(tmpDir, "config.ts"), "export const cfg = {};");
      execFileSync("git", ["add", "config.ts"], { cwd: tmpDir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir, stdio: "ignore" });

      // Add a secret into the diff
      fs.writeFileSync(
        path.join(tmpDir, "config.ts"),
        'export const cfg = { key: "sk-proj-999888777666555444333222111" };'
      );

      const bundle = await buildReviewBundle({
        workspaceRoot: tmpDir,
        taskId: "c2c_sec1",
        iteration: 1,
      });

      expect(bundle.text).toContain("[REDACTED]");
      expect(bundle.text).not.toContain("sk-proj-999888777666555444333222111");
    });
  });
});
