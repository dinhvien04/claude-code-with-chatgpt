import crypto from "node:crypto";
import { Workspace } from "../workspace/manager.js";
import { gitDiff } from "../workspace/git.js";
import { sanitizeExecutionOutput } from "../execution/sanitize.js";
import { readExecutionRecords } from "../execution/records.js";
import { readExecutionOutput } from "../execution/output.js";
import { buildDirectoryTree } from "./tree.js";
import { buildFileSnippets } from "./snippets.js";
import { PlanBundleOptions, ReviewBundleOptions, BundleResult } from "./types.js";

export const MAX_BUNDLE_BYTES = 48 * 1024; // 48 KB
export const MAX_DIFF_BYTES = 24 * 1024; // 24 KB
export const MAX_DIFF_LINES = 200;
export const MAX_OUTPUT_BYTES = 12 * 1024; // 12 KB
export const MAX_OUTPUT_LINES = 150;

export const MODE_P_PLAN_NOTICE =
  "[C2C Mode P: MCP is unavailable on this plan; using manual context fallback.]";

function generateTaskId(): string {
  return `c2c_${crypto.randomBytes(2).toString("hex")}`;
}

export async function buildPlanBundle(opts: PlanBundleOptions): Promise<BundleResult> {
  const workspace = new Workspace(opts.workspaceRoot);
  const taskId = opts.taskId ?? generateTaskId();
  const maxTotalBytes = opts.maxTotalBytes ?? MAX_BUNDLE_BYTES;
  const warnings: string[] = [];

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
    opts.goal.trim(),
    "",
    "WORKSPACE_SUMMARY:",
    `Name: ${workspace.name}`,
    `Type: ${projectInfo.projectType}`,
    `Languages: ${projectInfo.languages.join(", ") || "none"}`,
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

  let text = sections.join("\n");
  let sizeBytes = Buffer.byteLength(text, "utf8");
  let truncated = false;

  if (sizeBytes > maxTotalBytes) {
    truncated = true;
    warnings.push(`Bundle exceeded limit of ${maxTotalBytes} bytes and was truncated.`);
    const buf = Buffer.from(text, "utf8").subarray(0, maxTotalBytes);
    text = buf.toString("utf8") + "\n... (bundle truncated to stay under 48 KB)";
    sizeBytes = Buffer.byteLength(text, "utf8");
  }

  return {
    state: "INIT_P",
    taskId,
    iteration: 0,
    text,
    sizeBytes,
    truncated: truncated || treeResult.truncated,
    warnings,
  };
}

export async function buildReviewBundle(opts: ReviewBundleOptions): Promise<BundleResult> {
  const workspace = new Workspace(opts.workspaceRoot);
  const taskId = opts.taskId;
  const iteration = opts.iteration;
  const maxTotalBytes = opts.maxTotalBytes ?? MAX_BUNDLE_BYTES;
  const warnings: string[] = [];

  // Git diff
  let gitDiffText = "";
  try {
    const diff = gitDiff(workspace, {
      mode: opts.diffMode ?? "unstaged",
      maxBytes: MAX_DIFF_BYTES,
    });
    const sanitizedDiff = sanitizeExecutionOutput(diff.diff);
    let diffContent = sanitizedDiff.allowed ? sanitizedDiff.text : "(diff content redacted)";
    const diffLines = diffContent.split(/\r?\n/);
    if (diffLines.length > MAX_DIFF_LINES) {
      diffContent = diffLines.slice(0, MAX_DIFF_LINES).join("\n") + `\n... (diff truncated at ${MAX_DIFF_LINES} lines)`;
      warnings.push(`Git diff was truncated to ${MAX_DIFF_LINES} lines.`);
    }
    gitDiffText = diffContent;
    if (diff.hasMore) {
      gitDiffText += `\n... (diff truncated at ${MAX_DIFF_BYTES} bytes)`;
      warnings.push("Git diff was truncated to stay within byte bounds.");
    }
  } catch (err) {
    gitDiffText = `(No git diff available: ${(err as Error).message})`;
  }

  // Records / test status
  const records = readExecutionRecords(workspace.id);
  const latestRecord = records
    .filter((r) => r.taskId === taskId && r.iteration === iteration)
    .pop();

  let changedFilesDesc = "(not recorded)";
  let testsDesc = "(not recorded)";

  if (latestRecord) {
    if (Array.isArray(latestRecord.changedFiles)) {
      changedFilesDesc = latestRecord.changedFiles.map((f) => `- ${f}`).join("\n");
    } else {
      changedFilesDesc = `${latestRecord.changedFiles} file(s) modified`;
    }
    testsDesc = latestRecord.tests ?? "(none)";
  }

  // Execution logs / output if requested or available
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
      const logText = sanitizedLogs.allowed ? sanitizedLogs.text : "(logs redacted: sensitive content)";
      const lines = logText.split(/\r?\n/);
      let truncatedLogs = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
      if (lines.length > MAX_OUTPUT_LINES || Buffer.byteLength(truncatedLogs, "utf8") > MAX_OUTPUT_BYTES) {
        truncatedLogs = Buffer.from(truncatedLogs, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
        truncatedLogs += `\n... (logs truncated at ${MAX_OUTPUT_LINES} lines / ${MAX_OUTPUT_BYTES} bytes)`;
        warnings.push("Execution output logs were truncated to stay within bounds.");
      }
      outputSection = [
        "",
        "SANITIZED_EXECUTION_OUTPUT:",
        `Command: ${outputResult.meta.command ?? "(unspecified)"}`,
        `Exit Code: ${outputResult.meta.exitCode ?? 0}`,
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
    gitDiffText || "(empty diff)",
    "",
    "INSTRUCTION:",
    "Audit the diff and test execution output. Reply with [C2C] STATE: DONE if satisfied, or STATE: PLAN for the next iteration."
  );

  let text = sections.join("\n");
  let sizeBytes = Buffer.byteLength(text, "utf8");
  let truncated = false;

  if (sizeBytes > maxTotalBytes) {
    truncated = true;
    warnings.push(`Review bundle exceeded limit of ${maxTotalBytes} bytes and was truncated.`);
    const buf = Buffer.from(text, "utf8").subarray(0, maxTotalBytes);
    text = buf.toString("utf8") + "\n... (bundle truncated to stay under 48 KB)";
    sizeBytes = Buffer.byteLength(text, "utf8");
  }

  return {
    state: "EXECUTED_P",
    taskId,
    iteration,
    text,
    sizeBytes,
    truncated,
    warnings,
  };
}

