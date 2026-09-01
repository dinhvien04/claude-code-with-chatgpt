import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Workspace, WorkspaceError } from "../src/workspace/manager.js";
import { IgnoreRules } from "../src/workspace/ignore.js";
import { sanitizeExecutionOutput, MAX_OUTPUT_LINES, MAX_OUTPUT_BYTES } from "../src/execution/sanitize.js";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import { makeTmpDir, cleanup, write, isolateStateDir } from "./helpers.js";

describe("Security Red Team Regression Suite (SEC-01 to SEC-07)", () => {
  let root: string;
  let ws: Workspace;

  beforeAll(() => {
    root = makeTmpDir("sec-redteam-ws");
    // Standard workspace files
    write(root, "hello.txt", "safe file content\n");
    write(root, "src/index.ts", "export const app = 1;\n");

    // Sensitive files
    write(root, ".env", "OPENAI_API_KEY=sk-proj-supersecret1234567890\n");
    write(root, ".env.production", "PROD_SECRET=topsecret\n");
    write(root, ".env.example", "EXAMPLE_KEY=safe-placeholder\n");
    write(root, "secrets.json", '{"api_key": "secret-123"}\n');
    write(root, "credentials.json", '{"client_secret": "cred-123"}\n');
    write(root, "id_rsa", "PRIVATE KEY CONTENT\n");
    write(root, "id_ed25519", "ED25519 KEY CONTENT\n");
    write(root, "server.key", "SERVER KEY CONTENT\n");
    write(root, "cert.pem", "CERT PEM CONTENT\n");
    write(root, ".npmrc", "//registry.npmjs.org/:_authToken=npm-secret\n");
    write(root, ".netrc", "machine example.com login user password secret\n");
    write(root, ".git-credentials", "https://user:pass@github.com\n");
    write(root, "nested/.ssh/config", "Host *\n  IdentityFile ~/.ssh/id_rsa\n");

    // Extended sensitive files (SEC-06) & ADS rules (SEC-01) & Git internals (SEC-04)
    write(root, ".envrc", "export DIRENV_SECRET=123\n");
    write(root, "dev.env", "DEV_SECRET=456\n");
    write(root, "id_ed25519_sk", "ED25519 SK KEY CONTENT\n");
    write(root, "kubeconfig", "apiVersion: v1\n");
    write(root, "putty.ppk", "PuTTY-User-Key-File-2: ssh-rsa\n");
    write(root, ".vault-token", "s.vault-token-value\n");

    // .c2cignore custom rules for defense-in-depth hardening
    write(
      root,
      ".c2cignore",
      [
        "*::$DATA",
        "*:$DATA",
        "*/*:$DATA",
        "*:stream",
        ".git/",
        ".git/**",
        ".env.",
        ".env..",
        "*.env",
        ".envrc",
        "*.ppk",
        "kubeconfig",
        ".vault-token",
        "id_ed25519_sk",
        "secrets.json.",
        "credentials.json.",
        "*.json.",
      ].join("\n") + "\n"
    );

    // .git directory internals
    write(root, ".git/config", "[remote \"origin\"]\n  url = https://x-access-token:ghp_secrettoken123456789012@github.com/org/repo.git\n");
    write(root, ".git/HEAD", "ref: refs/heads/main\n");

    ws = new Workspace(root);
  });

  afterAll(() => {
    cleanup(root);
  });

  describe("SEC-01: Windows NTFS Alternate Data Streams (ADS) & Stream Suffixes", () => {
    it("rejects sensitive paths containing ::$DATA or stream specifiers", () => {
      const adsPaths = [
        ".env::$DATA",
        "secrets.json::$DATA",
        "credentials.json::$DATA",
        "hello.txt:stream",
      ];
      for (const p of adsPaths) {
        expect(() => ws.resolve(p)).toThrowError(WorkspaceError);
        try {
          ws.resolve(p);
        } catch (err) {
          const werr = err as WorkspaceError;
          expect(
            werr.code === "ACCESS_DENIED_SENSITIVE_FILE" ||
            werr.code === "INVALID_PATH" ||
            werr.code === "PATH_OUTSIDE_WORKSPACE"
          ).toBe(true);
        }
      }
    });

    it("rejects read_file attempts targeting sensitive ADS streams", async () => {
      await expect(ws.readFile(".env::$DATA")).rejects.toThrowError(WorkspaceError);
      await expect(ws.readFile("secrets.json::$DATA")).rejects.toThrowError(WorkspaceError);
    });
  });

  describe("SEC-02: Trailing Dot & Whitespace Path Normalization", () => {
    it("rejects path segments ending with trailing dots or spaces from accessing sensitive files", () => {
      const invalidSuffixPaths = [
        ".env.",
        ".env..",
        "secrets.json.",
        "credentials.json.",
      ];

      for (const p of invalidSuffixPaths) {
        expect(() => ws.resolve(p)).toThrowError(WorkspaceError);
        try {
          ws.resolve(p);
        } catch (err) {
          const werr = err as WorkspaceError;
          expect(
            werr.code === "ACCESS_DENIED_SENSITIVE_FILE" ||
            werr.code === "INVALID_PATH" ||
            werr.code === "PATH_OUTSIDE_WORKSPACE"
          ).toBe(true);
        }
      }
    });

    it("ensures .env. cannot be read through readFile", async () => {
      await expect(ws.readFile(".env.")).rejects.toThrowError(WorkspaceError);
      await expect(ws.readFile("secrets.json.")).rejects.toThrowError(WorkspaceError);
    });
  });

  describe("SEC-03: Case-Insensitive Sensitive File Denial on Windows & macOS", () => {
    it("denies uppercase and mixed-case sensitive filenames", () => {
      const caseVariants = [
        ".ENV",
        ".Env",
        ".ENV.PRODUCTION",
        "SECRETS.JSON",
        "Secrets.json",
        "CREDENTIALS.JSON",
        "Credentials.json",
        "ID_RSA",
        "Id_rsa",
        "SERVER.KEY",
        "CERT.PEM",
        ".NPMRC",
        ".NETRC",
      ];

      for (const variant of caseVariants) {
        expect(() => ws.resolve(variant)).toThrowError(WorkspaceError);
        try {
          ws.resolve(variant);
        } catch (err) {
          const werr = err as WorkspaceError;
          expect(
            werr.code === "ACCESS_DENIED_SENSITIVE_FILE" ||
            werr.code === "PATH_OUTSIDE_WORKSPACE"
          ).toBe(true);
        }
      }
    });

    it("allows .env.example regardless of casing convention", () => {
      const resolved = ws.resolve(".env.example");
      expect(resolved.rel.toLowerCase()).toBe(".env.example");
    });

    it("IgnoreRules.isSensitive identifies case variants on case-insensitive platforms", () => {
      const rules = new IgnoreRules(root);
      expect(rules.isSensitive(".env")).toBe(true);
      expect(rules.isSensitive("secrets.json")).toBe(true);
      expect(rules.isSensitive("id_rsa")).toBe(true);
    });
  });

  describe("SEC-04: .git/config, Worktree/Submodule .git Files, and Internal Git Files Denial", () => {
    it("denies reading .git/config, worktree .git files, and internal git files via resolve / readFile", async () => {
      const gitFiles = [
        ".git/config",
        ".git/HEAD",
        ".git",
      ];

      for (const gf of gitFiles) {
        expect(() => ws.resolve(gf)).toThrowError(WorkspaceError);
        try {
          ws.resolve(gf);
        } catch (err) {
          const werr = err as WorkspaceError;
          expect(
            werr.code === "ACCESS_DENIED_SENSITIVE_FILE" ||
            werr.code === "PATH_OUTSIDE_WORKSPACE"
          ).toBe(true);
        }
        await expect(ws.readFile(gf)).rejects.toThrowError(WorkspaceError);
      }
    });

    it("denies access to a worktree/submodule .git pointer file", async () => {
      const worktreeRoot = makeTmpDir("sec-worktree-root");
      try {
        write(worktreeRoot, ".git", "gitdir: ../.git/worktrees/sub\n");
        write(worktreeRoot, "index.ts", "export const ok = 1;\n");
        const worktreeWs = new Workspace(worktreeRoot);

        expect(() => worktreeWs.resolve(".git")).toThrowError(WorkspaceError);
        await expect(worktreeWs.readFile(".git")).rejects.toThrowError(WorkspaceError);

        const listing = await worktreeWs.listDirectory(".", { depth: 2, limit: 50 });
        const paths = listing.entries.map((e) => e.path);
        expect(paths).not.toContain(".git");
      } finally {
        cleanup(worktreeRoot);
      }
    });

    it("hides .git internal files from listDirectory", async () => {
      const listing = await ws.listDirectory(".", { depth: 3, limit: 100 });
      const paths = listing.entries.map((e) => e.path);
      expect(paths.some((p) => p.startsWith(".git"))).toBe(false);
      expect(paths).not.toContain(".git/config");
    });
  });

  describe("SEC-05: Modern API Key Redactor Regexes in Sanitizer", () => {
    it("hard-rejects all private key formats (case-insensitive and modern types)", () => {
      const keyFormats = [
        "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----",
        "-----begin rsa private key-----\nMIIE...\n-----end rsa private key-----",
        "-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbg...\n-----END OPENSSH PRIVATE KEY-----",
        "-----begin openssh private key-----\nb3Blbg...\n-----end openssh private key-----",
        "-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion...\n-----END PGP PRIVATE KEY BLOCK-----",
        "-----begin pgp private key block-----\nVersion...\n-----end pgp private key block-----",
        "-----BEGIN EC PRIVATE KEY-----\nMHQC...\n-----END EC PRIVATE KEY-----",
        "-----begin ec private key-----\nMHQC...\n-----end ec private key-----",
        "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF...\n-----END ENCRYPTED PRIVATE KEY-----",
        "-----begin encrypted private key-----\nMIIF...\n-----end encrypted private key-----",
      ];
      for (const k of keyFormats) {
        const result = sanitizeExecutionOutput(k);
        expect(result.allowed).toBe(false);
        if (!result.allowed) {
          expect(result.reason).toBe("private_key");
        }
      }
    });

    it("redacts modern OpenAI project keys (sk-proj-...) via key-value and token patterns", () => {
      const input = "api_key: sk-proj-1234567890abcdef1234567890abcdef1234567890";
      const result = sanitizeExecutionOutput(input);
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.text).not.toContain("sk-proj-1234567890abcdef");
        expect(result.text).toContain("[REDACTED]");
      }
    });

    it("redacts Anthropic API keys (sk-ant-...) via authorization headers", () => {
      const input = "authorization: Bearer sk-ant-api03-abcdef1234567890_ABCDEF1234567890-XYZ";
      const result = sanitizeExecutionOutput(input);
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.text).not.toContain("sk-ant-api03-abcdef");
        expect(result.text).toContain("[REDACTED]");
      }
    });

    it("redacts Google AIza API keys", () => {
      const input = "Google key AIzaSyA1234567890_abcdefghijklmnopqrstuv in output";
      const result = sanitizeExecutionOutput(input);
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.text).not.toContain("AIzaSyA1234567890");
        expect(result.text).toContain("[REDACTED]");
      }
    });

    it("redacts GitHub PAT and classical tokens", () => {
      const input = "Tokens: ghp_123456789012345678901234 and github_pat_11AAAAAA00000000000000_12345678901234567890";
      const result = sanitizeExecutionOutput(input);
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.text).not.toContain("ghp_1234567890");
        expect(result.text).not.toContain("github_pat_");
      }
    });

    it("redacts Slack tokens and AWS keys", () => {
      const input = "Slack: xoxb-1234567890-1234567890-abcdef123456, AWS: AKIAIOSFODNN7EXAMPLE";
      const result = sanitizeExecutionOutput(input);
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.text).not.toContain("xoxb-1234567890");
        expect(result.text).toContain("[REDACTED]");
      }
    });

    it("redacts bearer tokens and pairing codes", () => {
      const input = "Authorization: Bearer c2c_at_abcdef1234567890abcdef1234567890\nPairing code: ABCD-EFGH";
      const result = sanitizeExecutionOutput(input);
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.text).not.toContain("c2c_at_");
        expect(result.text).not.toContain("ABCD-EFGH");
      }
    });

    it("redacts user home directories across platforms", () => {
      const input =
        "Path 1: /Users/alice/repo/file.ts\n" +
        "Path 2: /home/bob/repo/file.ts\n" +
        "Path 3: C:\\Users\\charlie\\repo\\file.ts\n" +
        "Path 4: D:\\Users\\david\\repo\\file.ts\n" +
        "Path 5: C:/Users/eva/repo/file.ts\n" +
        "Path 6: E:/Users/frank/repo/file.ts";
      const result = sanitizeExecutionOutput(input);
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.text).not.toContain("/Users/alice");
        expect(result.text).toContain("/Users/[user]");
        expect(result.text).not.toContain("/home/bob");
        expect(result.text).toContain("/home/[user]");
        expect(result.text).not.toContain("C:\\Users\\charlie");
        expect(result.text).toContain("C:\\Users\\[user]");
        expect(result.text).not.toContain("D:\\Users\\david");
        expect(result.text).toContain("D:\\Users\\[user]");
        expect(result.text).not.toContain("C:/Users/eva");
        expect(result.text).toContain("C:/Users/[user]");
        expect(result.text).not.toContain("E:/Users/frank");
        expect(result.text).toContain("E:/Users/[user]");
      }
    });

    it("enforces line and byte caps with truncation marker", () => {
      const hugeOutput = Array.from({ length: MAX_OUTPUT_LINES + 50 }, (_, i) => `log line ${i + 1}`).join("\n");
      const result = sanitizeExecutionOutput(hugeOutput);
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.truncated).toBe(true);
        expect(result.text).toContain("…[truncated]");
      }
    });
  });

  describe("SEC-06: Extended Sensitive File Patterns Coverage", () => {
    it("denies extended sensitive file patterns", () => {
      const extendedSecrets = [
        ".envrc",
        "dev.env",
        "id_ed25519_sk",
        "kubeconfig",
        "putty.ppk",
        ".vault-token",
      ];

      for (const secret of extendedSecrets) {
        expect(() => ws.resolve(secret)).toThrowError(WorkspaceError);
        try {
          ws.resolve(secret);
        } catch (err) {
          const werr = err as WorkspaceError;
          expect(
            werr.code === "ACCESS_DENIED_SENSITIVE_FILE" ||
            werr.code === "PATH_OUTSIDE_WORKSPACE"
          ).toBe(true);
        }
      }
    });
  });

  describe("SEC-07: Trust Proxy and Loopback Admin Protection", () => {
    let bridge: Bridge;
    let base: string;

    beforeAll(async () => {
      isolateStateDir();
      bridge = await startBridge({
        workspaceRoot: root,
        port: 0,
        persistRuntime: false,
        authStoreFile: path.join(makeTmpDir("sec-auth"), "store.json"),
      });
      base = bridge.localBaseUrl();
    });

    afterAll(async () => {
      await bridge.close();
    });

    it("rejects admin pairing requests with proxy headers even with valid adminToken", async () => {
      const responseWithXFF = await fetch(`${base}/admin/pairing`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bridge.adminToken}`,
          "x-forwarded-for": "203.0.113.195",
        },
      });
      expect(responseWithXFF.status).toBe(404);

      const responseWithCF = await fetch(`${base}/admin/pairing`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bridge.adminToken}`,
          "cf-connecting-ip": "203.0.113.195",
        },
      });
      expect(responseWithCF.status).toBe(404);
    });

    it("rejects admin info requests without authorization header", async () => {
      const response = await fetch(`${base}/admin/info`, { method: "GET" });
      expect(response.status).toBe(404);
    });

    it("allows admin pairing request directly from loopback without proxy headers", async () => {
      const response = await fetch(`${base}/admin/pairing`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bridge.adminToken}`,
        },
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as { code: string; expiresAt: number };
      expect(data.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(typeof data.expiresAt).toBe("number");
    });

    it("allows admin info request directly from loopback with valid token", async () => {
      const response = await fetch(`${base}/admin/info`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${bridge.adminToken}`,
        },
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as { service: string; workspaceId: string; pid: number };
      expect(data.workspaceId).toBe(bridge.workspace.id);
      expect(data.pid).toBe(process.pid);
    });
  });
});
