import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Package Packaging Invariants", () => {
  const pkgPath = path.resolve(__dirname, "../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  it("package.json has explicit files allowlist containing required distribution assets", () => {
    expect(pkg.files).toBeDefined();
    expect(Array.isArray(pkg.files)).toBe(true);

    const requiredEntries = ["bin", "dist", "skill", ".claude", "docs", "README.md", "README.zh-CN.md", "LICENSE"];
    for (const entry of requiredEntries) {
      expect(pkg.files).toContain(entry);
    }
  });

  it("pinned dependencies meet security guidelines", () => {
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies["@modelcontextprotocol/sdk"]).toBe("^1.30.0");
    expect(pkg.dependencies["@modelcontextprotocol/sdk"]).not.toBe("latest");
  });

  it("engines.node is strictly >=22.13.0", () => {
    expect(pkg.engines?.node).toBe(">=22.13.0");
  });
});
