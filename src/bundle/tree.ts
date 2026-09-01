import { Workspace } from "../workspace/manager.js";

export interface BuildTreeOptions {
  maxDepth?: number;
  maxEntries?: number;
}

export interface TreeResult {
  formattedTree: string;
  entryCount: number;
  truncated: boolean;
}

export async function buildDirectoryTree(
  workspace: Workspace,
  opts: BuildTreeOptions = {}
): Promise<TreeResult> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxEntries = opts.maxEntries ?? 100;

  try {
    const listResult = await workspace.listDirectory("", {
      depth: maxDepth,
      limit: maxEntries,
    });

    const lines: string[] = [];
    for (const entry of listResult.entries) {
      // Calculate depth from relative path parts
      const cleanPath = entry.path.endsWith("/") ? entry.path.slice(0, -1) : entry.path;
      const parts = cleanPath.split("/").filter(Boolean);
      const depth = Math.max(0, parts.length - 1);
      const indent = "  ".repeat(depth);
      const name = parts[parts.length - 1] ?? entry.path;
      const suffix = entry.type === "dir" ? "/" : "";
      lines.push(`${indent}${name}${suffix}`);
    }

    const truncated = listResult.hasMore || listResult.entries.length >= maxEntries;
    if (truncated) {
      lines.push(`  ... (tree truncated at ${listResult.entries.length} entries)`);
    }

    return {
      formattedTree: lines.join("\n"),
      entryCount: listResult.entries.length,
      truncated,
    };
  } catch (err) {
    return {
      formattedTree: "(unable to list directory)",
      entryCount: 0,
      truncated: false,
    };
  }
}

