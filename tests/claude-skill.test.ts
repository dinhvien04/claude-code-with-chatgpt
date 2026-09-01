import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("claude-skill: chatgpt-collab SKILL.md & settings.json", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const skillPath = path.join(projectRoot, ".claude", "skills", "chatgpt-collab", "SKILL.md");
  const settingsPath = path.join(projectRoot, ".claude", "settings.json");

  describe("SKILL.md existence and structure", () => {
    it("exists and is non-empty", () => {
      expect(fs.existsSync(skillPath)).toBe(true);
      const content = fs.readFileSync(skillPath, "utf8");
      expect(content.length).toBeGreaterThan(100);
    });

    it("has valid YAML frontmatter with required attributes", () => {
      const content = fs.readFileSync(skillPath, "utf8");
      expect(content.startsWith("---")).toBe(true);
      const parts = content.split("---");
      expect(parts.length).toBeGreaterThanOrEqual(3);
      const frontmatter = parts[1];
      expect(frontmatter).toMatch(/name:\s*chatgpt-collab/);
      expect(frontmatter).toMatch(/description:\s*.+/);
    });

    it("contains all core sections and golden rules", () => {
      const content = fs.readFileSync(skillPath, "utf8");
      // Core sections
      expect(content).toContain("# ChatGPT Collaboration");
      expect(content).toMatch(/## 1\.\s*Core Principles & Golden Rules/i);
      expect(content).toMatch(/## 2\.\s*Setup & Pairing Workflow/i);
      expect(content).toMatch(/## 3\.\s*Dual-Plane Protocol & State Machine/i);
      expect(content).toMatch(/## 4\.\s*Prompt Templates/i);
      expect(content).toMatch(/## 5\.\s*Execution Checkpoint Workflows/i);
      expect(content).toMatch(/## 6\.\s*Recovery & Troubleshooting Map/i);

      // Invariants and principles
      expect(content).toContain("Dual-Plane Separation");
      expect(content).toMatch(/<\s*1\s*KB/i);
      expect(content).toContain("Mode C");
      expect(content).toContain("c2c doctor");
      expect(content).toMatch(/read-only/i);
    });

    it("defines the full protocol state machine and states", () => {
      const content = fs.readFileSync(skillPath, "utf8");
      const requiredWireStates = [
        "INIT",
        "PLAN",
        "EXECUTING",
        "EXECUTED",
        "REVIEW",
        "DONE",
        "BLOCKED",
        "HANDOFF",
      ];
      for (const state of requiredWireStates) {
        expect(content).toContain(state);
      }

      const checkpointStates = [
        "PLAN_RECEIVED",
        "EXECUTED_LOCAL",
        "EXECUTED_SENT",
      ];
      for (const state of checkpointStates) {
        expect(content).toContain(state);
      }
    });

    it("contains all required structured prompt templates", () => {
      const content = fs.readFileSync(skillPath, "utf8");
      // Boot Prompt
      expect(content).toMatch(/Boot Prompt/i);
      expect(content).toContain("planning and review intelligence");
      expect(content).toContain("workspace_info");
      expect(content).not.toContain("file_outline");

      // INIT Prompt
      expect(content).toContain("STATE: INIT");
      expect(content).toContain("TASK_ID:");
      expect(content).toContain("GOAL:");
      expect(content).toContain("INSTRUCTION:");

      // PLAN Response
      expect(content).toContain("STATE: PLAN");
      expect(content).toContain("RATIONALE:");
      expect(content).toContain("ACTIONS:");
      expect(content).toContain("SUCCESS_CRITERIA:");

      // EXECUTED Prompt
      expect(content).toContain("STATE: EXECUTED");
      expect(content).toContain("CHANGED_FILES:");
      expect(content).toContain("TESTS:");

      // HANDOFF Prompt
      expect(content).toContain("STATE: HANDOFF");
      expect(content).toContain("PROGRESS:");
      expect(content).toContain("KNOWN_ISSUES:");
      expect(content).toContain("NEXT_EXPECTED_STEP:");
    });
  });

  describe("settings.json validation", () => {
    it("exists and is valid JSON", () => {
      expect(fs.existsSync(settingsPath)).toBe(true);
      const raw = fs.readFileSync(settingsPath, "utf8");
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(raw);
      }).not.toThrow();
      expect(parsed).toBeTypeOf("object");
      expect(parsed).not.toBeNull();
    });

    it("configures required permissions for CLI and build tools", () => {
      const raw = fs.readFileSync(settingsPath, "utf8");
      const settings = JSON.parse(raw) as { permissions?: { allow?: string[] } };
      expect(settings.permissions).toBeDefined();
      expect(Array.isArray(settings.permissions?.allow)).toBe(true);
      const allowList = settings.permissions!.allow!;
      expect(allowList.some((cmd) => cmd.includes("c2c"))).toBe(true);
      expect(allowList.some((cmd) => cmd.includes("pnpm") || cmd.includes("node"))).toBe(true);
    });
  });
});
