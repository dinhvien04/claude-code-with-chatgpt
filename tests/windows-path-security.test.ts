import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace, WorkspaceError } from "../src/workspace/manager.js";

describe("Windows Path Security Invariants", () => {
  let tmpDir: string;
  let workspace: Workspace;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "c2c-win-path-test-"));
    workspace = new Workspace(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("rejects Windows DOS reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)", () => {
    const reservedNames = [
      "CON", "con", "prn", "PRN", "aux", "AUX", "nul", "NUL",
      "COM1", "com9", "lpt1", "LPT9", "con.txt", "nul.json", "aux.tar.gz"
    ];

    for (const name of reservedNames) {
      expect(() => workspace.resolve(name)).toThrow(WorkspaceError);
      expect(() => workspace.resolve(`sub/${name}`)).toThrow(WorkspaceError);
      expect(() => workspace.resolve(`sub/${name}/file.txt`)).toThrow(WorkspaceError);
    }
  });

  it("rejects Windows trailing dots and spaces in path segments", () => {
    expect(() => workspace.resolve("foo.")).toThrow(WorkspaceError);
    expect(() => workspace.resolve("foo ")).toThrow(WorkspaceError);
    expect(() => workspace.resolve("foo.../bar")).toThrow(WorkspaceError);
    expect(() => workspace.resolve("foo   /bar")).toThrow(WorkspaceError);
  });

  it("rejects Windows Alternate Data Streams (::$DATA)", () => {
    expect(() => workspace.resolve("secret.txt::$DATA")).toThrow(WorkspaceError);
    expect(() => workspace.resolve("folder::$DATA/secret.txt")).toThrow(WorkspaceError);
  });

  it("allows normal valid paths safely", () => {
    const valid = workspace.resolve("src/index.ts");
    expect(valid.rel).toBe("src/index.ts");
    expect(valid.abs).toBe(path.join(tmpDir, "src", "index.ts"));
  });
});
