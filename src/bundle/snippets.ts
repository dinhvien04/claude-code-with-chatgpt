import { Workspace } from "../workspace/manager.js";
import { sanitizeExecutionOutput } from "../execution/sanitize.js";

export interface SnippetOptions {
  maxFiles?: number;
  maxLinesPerFile?: number;
  maxBytesPerFile?: number;
}

export interface SnippetResult {
  formattedSnippets: string;
  filesIncluded: string[];
  skippedFiles: string[];
  warnings: string[];
}

export async function buildFileSnippets(
  workspace: Workspace,
  candidateFiles: string[],
  opts: SnippetOptions = {}
): Promise<SnippetResult> {
  const maxFiles = opts.maxFiles ?? 3;
  const maxLinesPerFile = opts.maxLinesPerFile ?? 200;
  const maxBytesPerFile = opts.maxBytesPerFile ?? 16 * 1024; // 16 KB

  const formattedBlocks: string[] = [];
  const filesIncluded: string[] = [];
  const skippedFiles: string[] = [];
  const warnings: string[] = [];

  const filesToProcess = candidateFiles.slice(0, maxFiles);
  if (candidateFiles.length > maxFiles) {
    const omitted = candidateFiles.slice(maxFiles);
    skippedFiles.push(...omitted);
    warnings.push(
      `File snippet limit reached. Omitted ${omitted.length} candidate file(s): ${omitted.join(", ")}`
    );
  }

  for (const relPath of filesToProcess) {
    try {
      // Workspace.readFile handles path resolution, symlink checks, sensitive file filtering, and .c2cignore
      const fileData = await workspace.readFile(relPath, { maxBytes: maxBytesPerFile });
      const rawContent = fileData.content;

      // Sanitize execution output/content for sensitive secrets (API keys, home dirs, etc.)
      const sanitized = sanitizeExecutionOutput(rawContent);
      const cleanText = sanitized.allowed ? sanitized.text : "(content redacted: sensitive)";

      const lines = cleanText.split(/\r?\n/);
      let snippetContent = lines.slice(0, maxLinesPerFile).join("\n");
      let wasLineTruncated = lines.length > maxLinesPerFile;

      if (fileData.truncated || wasLineTruncated) {
        snippetContent += `\n... (file content truncated at ${Math.min(lines.length, maxLinesPerFile)} lines / ${maxBytesPerFile} bytes)`;
      }

      formattedBlocks.push(`=== FILE: ${relPath} ===\n${snippetContent}\n=== END FILE ===`);
      filesIncluded.push(relPath);
    } catch (err) {
      skippedFiles.push(relPath);
      warnings.push(`Could not read candidate file '${relPath}': ${(err as Error).message}`);
    }
  }

  return {
    formattedSnippets: formattedBlocks.join("\n\n"),
    filesIncluded,
    skippedFiles,
    warnings,
  };
}
