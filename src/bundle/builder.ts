import crypto from "node:crypto";
import { Workspace } from "../workspace/manager.js";
import { gitDiff } from "../workspace/git.js";
import { sanitizeExecutionOutput } from "../execution/sanitize.js";
import { readExecutionRecords } from "../execution/records.js";
import { readExecutionOutput } from "../execution/output.js";
import { buildDirectoryTree } from "./tree.js";
import { buildFileSnippets } from "./snippets.js";
import { buildUntrackedFileDiffs } from "./untracked.js";
import { PlanBundleOptions, ReviewBundleOptions, BundleResult } from "./types.js";

export const MAX_BUNDLE_BYTES = 48 * 1024; // 48 KB
export const MAX_DIFF_BYTES = 24 * 1024; // 24 KB
export const MAX_DIFF_LINES = 200;
export const MAX_OUTPUT_BYTES = 12 * 1024; // 12 KB
export const MAX_OUTPUT_LINES = 150;

export const MODE_P_PLAN_NOTICE =
  "[C2C Mode P: MCP is unavailable on this plan; using manual context fallback.]";

export const TASK_ID_REGEX = /^c2c_[a-zA-Z0-9_-]{1,64}$/;

export function validateTaskId(taskId: string): string {
  const trimmed = taskId.trim();
  if (!TASK_ID_REGEX.test(trimmed)) {
    throw new Error(
      `Invalid taskId '${taskId}': must match pattern ^c2c_[a-zA-Z0-9_-]{1,64}$ and contain no newlines or control characters.`
    );
  }
  return trimmed;
}

export function sanitizeSingleLine(input: string, maxLen = 120): string {
  return input
    .replace(/[\r\n\x00-\x1F\x7F]+/g, " ")
    .replace(/\[C2C\]/gi, "[_C2C_]")
    .trim()
    .slice(0, maxLen);
}

function generateTaskId(): string {
  // 64 bits (8 bytes = 16 hex chars) of CSPRNG entropy
  return `c2c_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Truncates text so that its total UTF-8 byte length is strictly <= maxBytes.
 * Guarantees:
 * 1. Final byte size <= maxBytes (leaves space for notice marker before slicing).
 * 2. UTF-8 multibyte boundary safe: never slices in the middle of a multi-byte codepoint.
 */
export function truncateUtf8ToBytes(
  text: string,
  maxBytes: number,
  notice = "\n... (bundle truncated to stay under limit)"
): { text: string; sizeBytes: number; truncated: boolean } {
  const textBytes = Buffer.byteLength(text, "utf8");
  if (textBytes <= maxBytes) {
    return { text, sizeBytes: textBytes, truncated: false };
  }

  const noticeBytes = Buffer.byteLength(notice, "utf8");
  const budget = Math.max(0, maxBytes - noticeBytes);

  const buf = Buffer.from(text, "utf8");
  let cut = Math.min(buf.length, budget);

  // If cut lands in the middle of a UTF-8 continuation byte (0b10xxxxxx), step backwards
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) {
    cut--;
  }

  // If cut lands on a leading byte whose sequence extends beyond budget, step backwards past it
  if (cut > 0) {
    const lead = buf[cut - 1];
    if ((lead & 0xe0) === 0xc0 && cut - 1 + 2 > budget) {
      cut -= 1;
    } else if ((lead & 0xf0) === 0xe0 && cut - 1 + 3 > budget) {
      cut -= 1;
    } else if ((lead & 0xf8) === 0xf0 && cut - 1 + 4 > budget) {
      cut -= 1;
    }
  }

  const safeBody = buf.subarray(0, cut).toString("utf8");
  const finalText = safeBody + notice;
  const finalBytes = Buffer.byteLength(finalText, "utf8");

  return {
    text: finalText,
    sizeBytes: finalBytes,
    truncated: true,
  };
}

export async function buildPlanBundle(opts: PlanBundleOptions): Promise<BundleResult> {
  const workspace = new Workspace(opts.workspaceRoot);
  const rawTaskId = opts.taskId ?? generateTaskId();
  const taskId = validateTaskId(rawTaskId);
  const maxTotalBytes = opts.maxTotalBytes ?? MAX_BUNDLE_BYTES;
  const warnings: string[] = [];

  // Sanitize goal text
  const sanitizedGoal = sanitizeExecutionOutput(opts.goal);
  if (!sanitizedGoal.allowed) {
    throw new Error("Goal was rejected: contained private keys or restricted sensitive content.");
  }
  const cleanGoal = sanitizedGoal.text.replace(/\[C2C\]/gi, "[_C2C_]").trim();

  const projectInfo = workspace.detectProject();
  const treeResult = await buildDirectoryTree(workspace, {
    maxDepth: opts.maxDepth ?? 3,
    maxEntries: opts.maxTreeEntries ?? 100,
  });

  if (treeResult.truncated) {
    warnings.push("Directory tree was truncated to stay within size limits.");
  }

  let snippetsResult = {
    formattedSnippets: "",
    filesIncluded: [] as string[],
    skippedFiles: [] as string[],
    warnings: [] as string[],
  };

  if (opts.files && opts.files.length > 0) {
    snippetsResult = await buildFileSnippets(workspace, opts.files);
    warnings.push(...snippetsResult.warnings);
  }

  const safeWorkspaceName = sanitizeSingleLine(workspace.name);
  const safeProjectType = sanitizeSingleLine(projectInfo.projectType);
  const safeLanguages = sanitizeSingleLine(projectInfo.languages.join(", ") || "none");

  const sections: string[] = [
    "[C2C]",
    "STATE: INIT_P",
    `TASK_ID: ${taskId}`,
    "ITERATION: 0",
    "EXECUTOR: claude-code",
    "MODE: P (Plus Manual Context Handoff)",
    "",
    "NOTICE:",
    MODE_P_PLAN_NOTICE,
    "",
    "GOAL:",
    cleanGoal,
    "",
    "WORKSPACE_SUMMARY:",
    `Name: ${safeWorkspaceName}`,
    `Type: ${safeProjectType}`,
    `Languages: ${safeLanguages}`,
    "",
    "BOUNDED_TREE:",
    treeResult.formattedTree || "(empty workspace)",
  ];

  if (snippetsResult.formattedSnippets) {
    sections.push("", "TARGET_SOURCE_SNIPPETS:", snippetsResult.formattedSnippets);
  }

  sections.push(
    "",
    "INSTRUCTION:",
    "Review the provided context bundle and produce a structured [C2C] STATE: PLAN response."
  );

  const rawText = sections.join("\n");
  const { text, sizeBytes, truncated: bundleTruncated } = truncateUtf8ToBytes(
    rawText,
    maxTotalBytes,
    "\n... (bundle truncated to stay under 48 KB)"
  );

  if (bundleTruncated) {
    warnings.push(`Bundle exceeded limit of ${maxTotalBytes} bytes and was truncated.`);
  }

  return {
    state: "INIT_P",
    taskId,
    iteration: 0,
    text,
    sizeBytes,
    truncated: bundleTruncated || treeResult.truncated,
    warnings,
  };
}

export async function buildReviewBundle(opts: ReviewBundleOptions): Promise<BundleResult> {
  const workspace = new Workspace(opts.workspaceRoot);
  const taskId = validateTaskId(opts.taskId);
  const iteration = Math.max(0, Math.floor(opts.iteration));
  const maxTotalBytes = opts.maxTotalBytes ?? MAX_BUNDLE_BYTES;
  const warnings: string[] = [];

  // 1. Git diff for tracked files (default: "head" for complete staged + unstaged changes vs HEAD)
  const diffMode = opts.diffMode ?? "head";
  let trackedDiffText = "";
  let trackedDiffBytes = 0;
  let trackedDiffLines = 0;

  try {
    const diff = gitDiff(workspace, {
      mode: diffMode,
      maxBytes: MAX_DIFF_BYTES,
    });
    if (diff.diff) {
      const sanitizedDiff = sanitizeExecutionOutput(diff.diff);
      let diffContent = sanitizedDiff.allowed ? sanitizedDiff.text : "(diff content redacted)";
      const diffLines = diffContent.split(/\r?\n/);
      if (diffLines.length > MAX_DIFF_LINES) {
        diffContent =
          diffLines.slice(0, MAX_DIFF_LINES).join("\n") +
          `\n... (diff truncated at ${MAX_DIFF_LINES} lines)`;
        warnings.push(`Git diff was truncated to ${MAX_DIFF_LINES} lines.`);
      }
      trackedDiffText = diffContent;
      trackedDiffBytes = Buffer.byteLength(trackedDiffText, "utf8");
      trackedDiffLines = diffLines.length;

      if (diff.hasMore) {
        trackedDiffText += `\n... (diff truncated at ${MAX_DIFF_BYTES} bytes)`;
        warnings.push("Git diff was truncated to stay within byte bounds.");
      }
    }
  } catch (err) {
    trackedDiffText = `(No git diff available: ${(err as Error).message})`;
  }

  // 2. Untracked safe files (synthesized diffs)
  let untrackedDiffText = "";
  const remainingDiffBytes = Math.max(0, MAX_DIFF_BYTES - trackedDiffBytes);
  const remainingDiffLines = Math.max(0, MAX_DIFF_LINES - trackedDiffLines);

  if (remainingDiffBytes > 100 && remainingDiffLines > 5) {
    try {
      const untrackedResult = await buildUntrackedFileDiffs(workspace, {
        maxTotalBytes: remainingDiffBytes,
        maxTotalLines: remainingDiffLines,
      });
      if (untrackedResult.formattedDiff) {
        untrackedDiffText = untrackedResult.formattedDiff;
      }
      if (untrackedResult.warnings.length > 0) {
        warnings.push(...untrackedResult.warnings);
      }
    } catch {
      // Untracked diff error is non-fatal
    }
  }

  // Combine tracked and untracked diffs
  const combinedDiffParts: string[] = [];
  if (trackedDiffText) {
    combinedDiffParts.push(trackedDiffText);
  }
  if (untrackedDiffText) {
    combinedDiffParts.push(untrackedDiffText);
  }
  const finalDiffText = combinedDiffParts.join("\n\n") || "(empty diff)";

  // 3. Records / test status with strict sanitization
  const records = readExecutionRecords(workspace.id);
  const latestRecord = records
    .filter((r) => r.taskId === taskId && r.iteration === iteration)
    .pop();

  let changedFilesDesc = "(not recorded)";
  let testsDesc = "(none)";

  if (latestRecord) {
    if (Array.isArray(latestRecord.changedFiles)) {
      const safeFiles = latestRecord.changedFiles
        .filter((f) => !workspace.ignoreRules.isSensitive(f))
        .map((f) => `- ${sanitizeSingleLine(f, 200)}`);
      changedFilesDesc =
        safeFiles.length > 0 ? safeFiles.join("\n") : "(no non-sensitive files modified)";
    } else {
      changedFilesDesc = `${parseInt(String(latestRecord.changedFiles), 10) || 0} file(s) modified`;
    }

    if (latestRecord.tests) {
      const sanitizedTests = sanitizeExecutionOutput(latestRecord.tests);
      testsDesc = sanitizedTests.allowed
        ? sanitizedTests.text.replace(/\[C2C\]/gi, "[_C2C_]")
        : "(tests redacted: sensitive content)";
    }
  }

  // 4. Execution logs / output if requested or available
  let outputSection = "";
  if (opts.includeOutput !== false) {
    let outputResult: ReturnType<typeof readExecutionOutput> | null = null;
    if (opts.outputId !== undefined) {
      outputResult = readExecutionOutput(workspace.id, opts.outputId);
    } else if (latestRecord?.outputId !== undefined) {
      outputResult = readExecutionOutput(workspace.id, latestRecord.outputId);
    }

    if (outputResult && outputResult.ok) {
      const sanitizedLogs = sanitizeExecutionOutput(outputResult.text);
      const logText = sanitizedLogs.allowed
        ? sanitizedLogs.text
        : "(logs redacted: sensitive content)";
      const lines = logText.split(/\r?\n/);
      let truncatedLogs = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
      if (
        lines.length > MAX_OUTPUT_LINES ||
        Buffer.byteLength(truncatedLogs, "utf8") > MAX_OUTPUT_BYTES
      ) {
        const { text: safeTruncated } = truncateUtf8ToBytes(
          truncatedLogs,
          MAX_OUTPUT_BYTES,
          `\n... (logs truncated at ${MAX_OUTPUT_LINES} lines / ${MAX_OUTPUT_BYTES} bytes)`
        );
        truncatedLogs = safeTruncated;
        warnings.push("Execution output logs were truncated to stay within bounds.");
      }

      const safeCommand = sanitizeSingleLine(outputResult.meta.command ?? "(unspecified)");
      const safeExitCode = outputResult.meta.exitCode ?? 0;

      outputSection = [
        "",
        "SANITIZED_EXECUTION_OUTPUT:",
        `Command: ${safeCommand}`,
        `Exit Code: ${safeExitCode}`,
        truncatedLogs,
      ].join("\n");
    }
  }

  const sections: string[] = [
    "[C2C]",
    "STATE: EXECUTED_P",
    `TASK_ID: ${taskId}`,
    `ITERATION: ${iteration}`,
    "EXECUTOR: claude-code",
    "MODE: P (Plus Manual Context Handoff)",
    "",
    "NOTICE:",
    MODE_P_PLAN_NOTICE,
    "",
    "RESULT:",
    "Execution completed.",
    "",
    "CHANGED_FILES:",
    changedFilesDesc,
    "",
    "SANITIZED_TESTS:",
    testsDesc,
  ];

  if (outputSection) {
    sections.push(outputSection);
  }

  sections.push(
    "",
    "BOUNDED_GIT_DIFF:",
    finalDiffText,
    "",
    "INSTRUCTION:",
    "Audit the diff and test execution output. Reply with [C2C] STATE: DONE if satisfied, or STATE: PLAN for the next iteration."
  );

  const rawText = sections.join("\n");
  const { text, sizeBytes, truncated: bundleTruncated } = truncateUtf8ToBytes(
    rawText,
    maxTotalBytes,
    "\n... (bundle truncated to stay under 48 KB)"
  );

  if (bundleTruncated) {
    warnings.push(`Review bundle exceeded limit of ${maxTotalBytes} bytes and was truncated.`);
  }

  return {
    state: "EXECUTED_P",
    taskId,
    iteration,
    text,
    sizeBytes,
    truncated: bundleTruncated,
    warnings,
  };
}
