import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeSecureJson, readJsonIfExists } from "../src/config/paths.js";

describe("Atomic Secure JSON Persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "c2c-atomic-write-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("writes valid JSON atomically and reads back correctly", () => {
    const targetFile = path.join(tmpDir, "sub", "config.json");
    const data = { foo: "bar", count: 42, nested: { enabled: true } };

    writeSecureJson(targetFile, data);

    const read = readJsonIfExists<typeof data>(targetFile);
    expect(read).toEqual(data);
  });

  it("overwrites existing JSON atomically without leaving orphan temp files", () => {
    const targetFile = path.join(tmpDir, "state.json");
    writeSecureJson(targetFile, { version: 1 });
    writeSecureJson(targetFile, { version: 2 });

    const read = readJsonIfExists<{ version: number }>(targetFile);
    expect(read).toEqual({ version: 2 });

    const dirFiles = fs.readdirSync(tmpDir);
    const tempFiles = dirFiles.filter((f) => f.includes(".tmp"));
    expect(tempFiles.length).toBe(0);
  });

  it("returns null on non-existent or invalid JSON files", () => {
    expect(readJsonIfExists(path.join(tmpDir, "nonexistent.json"))).toBeNull();

    const brokenFile = path.join(tmpDir, "broken.json");
    fs.writeFileSync(brokenFile, "{ malformed json ");
    expect(readJsonIfExists(brokenFile)).toBeNull();
  });
});
