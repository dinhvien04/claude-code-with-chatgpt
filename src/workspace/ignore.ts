import ignore, { type Ignore } from "ignore";
import fs from "node:fs";
import path from "node:path";

const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";
const normCase = (p: string): string => (CASE_INSENSITIVE ? p.toLowerCase() : p);

/**
 * Files that must never be readable through MCP, regardless of user config.
 * Matched with gitignore semantics against workspace-relative paths.
 */
export const SENSITIVE_PATTERNS: string[] = [
  ".git",
  ".git/",
  ".git/**",
  ".env",
  ".env.*",
  "*.env",
  ".envrc",
  "!.env.example",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "id_rsa",
  "id_rsa.*",
  "id_ed25519",
  "id_ed25519.*",
  "id_ed25519_*",
  "id_ecdsa",
  "id_ecdsa.*",
  "id_dsa",
  "id_dsa.*",
  "*.ppk",
  ".ssh/",
  ".aws/",
  ".gnupg/",
  ".npmrc",
  ".netrc",
  "_netrc",
  ".git-credentials",
  "*.keychain",
  "*.keychain-db",
  ".cloudflared/",
  "credentials.json",
  "client_secret*.json",
  "service-account*.json",
  "secrets.json",
  "kubeconfig",
  ".kube/",
  ".docker/config.json",
  ".vault-token",
  "cookies.sqlite",
  "Cookies",
  ".c2c-secrets*",
];

/** High-noise directories excluded from listing/search by default. */
export const NOISE_PATTERNS: string[] = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".nuxt/",
  ".svelte-kit/",
  "coverage/",
  ".cache/",
  ".turbo/",
  ".venv/",
  "venv/",
  "__pycache__/",
  ".pytest_cache/",
  ".mypy_cache/",
  "target/",
  ".gradle/",
  ".idea/",
  ".tooling/",
  ".pnpm-store/",
  ".DS_Store",
  "*.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
];

export class IgnoreRules {
  private sensitive: Ignore;
  private noise: Ignore;
  private custom: Ignore;

  constructor(workspaceRoot: string) {
    this.sensitive = ignore().add(SENSITIVE_PATTERNS.map((p) => normCase(p)));
    this.noise = ignore().add(NOISE_PATTERNS.map((p) => normCase(p)));
    this.custom = ignore();
    const c2cignore = path.join(workspaceRoot, ".c2cignore");
    try {
      if (fs.existsSync(c2cignore)) {
        const lines = fs.readFileSync(c2cignore, "utf8");
        this.custom.add(CASE_INSENSITIVE ? lines.toLowerCase() : lines);
      }
    } catch {
      // unreadable .c2cignore: fall back to defaults only
    }
  }

  /** True when the path must be denied with ACCESS_DENIED_SENSITIVE_FILE. */
  isSensitive(relPath: string): boolean {
    if (!relPath || relPath === ".") return false;
    const normalized = normCase(relPath);
    return this.sensitive.ignores(normalized) || this.custom.ignores(normalized);
  }

  /** True when the path should be hidden from listing/search (not an error). */
  isNoise(relPath: string): boolean {
    if (!relPath || relPath === ".") return false;
    const normalized = normCase(relPath);
    return this.noise.ignores(normalized);
  }

  isHidden(relPath: string): boolean {
    return this.isSensitive(relPath) || this.isNoise(relPath);
  }
}
