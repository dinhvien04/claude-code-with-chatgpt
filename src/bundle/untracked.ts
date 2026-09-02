import fs from "node:fs";
import { Workspace } from "../workspace/manager.js";
import { runGit } from "../workspace/git.js";
import { sanitizeExecutionOutput } from "../execution/sanitize.js";
import { truncateUtf8ToBytes } from "./truncate.js";

export interface UntrackedDiffOptions {
  maxFiles?: number;
  maxLinesPerFile?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
  maxTotalLines?: number;
}

export interface UntrackedFileDiffEntry {
  path: string;
  diff: string;
  bytes: number;
  lines: number;
  isBinary: boolean;
  truncated: boolean;
}

export interface UntrackedDiffResult {
  formattedDiff: string;
  filesIncluded: string[];
  skippedFiles: string[];
  totalBytes: number;
  totalLines: number;
  truncated: boolean;
  warnings: string[];
  entries: UntrackedFileDiffEntry[];
}

/**
 * Sanitizes untrusted filenames to prevent protocol/header injection.
 */
export function sanitizeUntrustedFilename(p: string): string {
  return p.replace(/[\r\n\x00-\x1F\x7F]+/g, "_").trim();
}

/**
 * Enumerates safe untracked files in the workspace and synthesizes unified diff
 * blocks ("new file mode 100644") without mutating Git index or workspace state.
 *
 * Enforces:
 * - Workspace boundary resolution & path containment
 * - IgnoreRules & sensitive file filtering (.env, *.pem, *.key, id_rsa*, credentials.json, etc.)
 * - Binary file detection (metadata only / skipped)
 * - Per-file and aggregate byte and line bounds
 * - Exact UTF-8 safe hard byte truncation without multi-byte character corruption
 * - Full credential and secret sanitization
 */
export async function buildUntrackedFileDiffs(
  workspace: Workspace,
  opts: UntrackedDiffOptions = {}
): Promise<UntrackedDiffResult> {
  const maxFiles = opts.maxFiles ?? 20;
  const maxLinesPerFile = opts.maxLinesPerFile ?? 5000;
  const maxBytesPerFile = opts.maxBytesPerFile ?? 64 * 1024 * 1024;
  const maxTotalBytes = opts.maxTotalBytes ?? 24 * 1024; // 24 KB aggregate for diffs
  const maxTotalLines = opts.maxTotalLines ?? 5000;

  const filesIncluded: string[] = [];
  const skippedFiles: string[] = [];
  const warnings: string[] = [];
  const diffBlocks: string[] = [];
  const entries: UntrackedFileDiffEntry[] = [];

  let accumulatedBytes = 0;
  let accumulatedLines = 0;
  let truncated = false;

  // Enumerate untracked files using git ls-files --others --exclude-standard -z -- .
  const gitRes = runGit(workspace.root, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]);
  if (!gitRes.ok || !gitRes.stdout) {
    return {
      formattedDiff: "",
      filesIncluded: [],
      skippedFiles: [],
      totalBytes: 0,
      totalLines: 0,
      truncated: false,
      warnings: [],
      entries: [],
    };
  }

  const untrackedRelPaths = gitRes.stdout.split("\0").filter((p) => p.trim().length > 0);

  for (const relPath of untrackedRelPaths) {
    if (filesIncluded.length >= maxFiles) {
      skippedFiles.push(relPath);
      truncated = true;
      warnings.push(`Untracked files truncated: max file limit of ${maxFiles} reached.`);
      break;
    }

    if (accumulatedBytes >= maxTotalBytes || accumulatedLines >= maxTotalLines) {
      skippedFiles.push(relPath);
      truncated = true;
      warnings.push("Untracked file diffs truncated: total budget exceeded.");
      break;
    }

    try {
      // 1. Resolve path within workspace containment
      const { abs, rel } = workspace.resolve(relPath);

      // 2. Sensitive file & IgnoreRules gate
      if (workspace.ignoreRules.isSensitive(rel) || workspace.ignoreRules.isNoise(rel)) {
        skippedFiles.push(rel);
        continue;
      }

      // 3. File existence & stat check
      const stat = await fs.promises.stat(abs).catch(() => null);
      if (!stat || !stat.isFile()) {
        continue;
      }

      const safeDisplayPath = sanitizeUntrustedFilename(rel);

      // 4. Binary check
      if (await workspace.isBinary(abs)) {
        const binaryNotice = [
          `diff --git a/${safeDisplayPath} b/${safeDisplayPath}`,
          `new file mode 100644`,
          `Binary files /dev/null and b/${safeDisplayPath} differ`,
        ].join("\n");
        const blockBytes = Buffer.byteLength(binaryNotice, "utf8");
        if (accumulatedBytes + blockBytes <= maxTotalBytes) {
          diffBlocks.push(binaryNotice);
          filesIncluded.push(rel);
          entries.push({
            path: safeDisplayPath,
            diff: binaryNotice,
            bytes: blockBytes,
            lines: 3,
            isBinary: true,
            truncated: false,
          });
          accumulatedBytes += blockBytes + 1;
          accumulatedLines += 3;
        } else {
          skippedFiles.push(rel);
          truncated = true;
        }
        continue;
      }

      // 5. Read file with strict limits
      const fileData = await workspace.readFile(rel, {
        maxBytes: maxBytesPerFile,
        maxLines: maxLinesPerFile,
      });

      // 6. Credential & secret sanitization
      const sanitized = sanitizeExecutionOutput(fileData.content);
      if (!sanitized.allowed) {
        skippedFiles.push(rel);
        warnings.push(`Untracked file '${safeDisplayPath}' was excluded: contained sensitive credentials or private key.`);
        continue;
      }

      const content = sanitized.text;
      const lines = content.split(/\r?\n/);
      const remainingLinesBudget = Math.min(maxLinesPerFile, maxTotalLines - accumulatedLines);

      let linesToInclude = lines;
      let fileTruncated = fileData.truncated || lines.length > remainingLinesBudget;

      if (lines.length > remainingLinesBudget) {
        linesToInclude = lines.slice(0, Math.max(0, remainingLinesBudget));
      }

      const diffHeader = [
        `diff --git a/${safeDisplayPath} b/${safeDisplayPath}`,
        `new file mode 100644`,
        `--- /dev/null`,
        `+++ b/${safeDisplayPath}`,
        `@@ -0,0 +1,${linesToInclude.length} @@`,
      ].join("\n");

      const diffBody = linesToInclude.map((l) => `+${l}`).join("\n");
      let fullBlock = `${diffHeader}\n${diffBody}`;

      if (fileTruncated) {
        fullBlock += `\n... (file '${safeDisplayPath}' diff truncated to stay within budget)`;
        truncated = true;
      }

      const blockBytes = Buffer.byteLength(fullBlock, "utf8");
      if (accumulatedBytes + blockBytes > maxTotalBytes) {
        // Truncate block to fit remaining byte budget using UTF-8 safe boundary truncation
        const remainingBytes = Math.max(0, maxTotalBytes - accumulatedBytes);
        if (remainingBytes > Buffer.byteLength(diffHeader, "utf8") + 35) {
          const { text: safeCutBlock } = truncateUtf8ToBytes(
            fullBlock,
            remainingBytes,
            `\n... (diff truncated at ${remainingBytes} bytes)`
          );
          diffBlocks.push(safeCutBlock);
          filesIncluded.push(rel);
          entries.push({
            path: safeDisplayPath,
            diff: safeCutBlock,
            bytes: Buffer.byteLength(safeCutBlock, "utf8"),
            lines: linesToInclude.length + 5,
            isBinary: false,
            truncated: true,
          });
          accumulatedBytes = maxTotalBytes;
          truncated = true;
        } else {
          skippedFiles.push(rel);
          truncated = true;
        }
        break;
      }

      diffBlocks.push(fullBlock);
      filesIncluded.push(rel);
      entries.push({
        path: safeDisplayPath,
        diff: fullBlock,
        bytes: blockBytes,
        lines: linesToInclude.length + 5,
        isBinary: false,
        truncated: fileTruncated,
      });
      accumulatedBytes += blockBytes + 1;
      accumulatedLines += linesToInclude.length + 5;
    } catch (err) {
      skippedFiles.push(relPath);
      warnings.push(`Could not include untracked file '${relPath}': ${(err as Error).message}`);
    }
  }

  const rawFormatted = diffBlocks.join("\n\n");
  const { text: finalFormatted, sizeBytes: finalBytes } = truncateUtf8ToBytes(
    rawFormatted,
    maxTotalBytes,
    "\n... (untracked diffs truncated)"
  );

  return {
    formattedDiff: finalFormatted,
    filesIncluded,
    skippedFiles,
    totalBytes: finalBytes,
    totalLines: accumulatedLines,
    truncated: truncated || finalBytes < Buffer.byteLength(rawFormatted, "utf8"),
    warnings,
    entries,
  };
}
