import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Package Metadata & Identity Invariants", () => {
  it("package.json has name 'claude-code-with-chatgpt' and accurate description", () => {
    const pkgPath = path.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    expect(pkg.name).toBe("claude-code-with-chatgpt");
    expect(pkg.description).toBe("ChatGPT thinks. Claude Code works.");
    expect(pkg.bin).toHaveProperty("c2c");
  });
});
