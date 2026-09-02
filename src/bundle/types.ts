export interface PlanBundleOptions {
  workspaceRoot: string;
  goal: string;
  taskId?: string;
  files?: string[];
  maxDepth?: number;
  maxTreeEntries?: number;
  maxTotalBytes?: number;
}

export interface ChangesetSummary {
  trackedChangedCount: number;
  safeUntrackedCount: number;
  sensitiveWithheldCount: number;
  totalChunks: number;
  currentChunk: number;
}

export interface ReviewBundleOptions {
  workspaceRoot: string;
  taskId: string;
  iteration: number;
  chunk?: number;
  diffMode?: "unstaged" | "staged" | "head";
  includeOutput?: boolean;
  outputId?: number;
  maxTotalBytes?: number;
}

export interface BundleResult {
  state: "INIT_P" | "EXECUTED_P";
  taskId: string;
  iteration: number;
  reviewComplete?: boolean;
  currentChunk?: number;
  totalChunks?: number;
  changesetSummary?: ChangesetSummary;
  text: string;
  sizeBytes: number;
  truncated: boolean;
  warnings: string[];
}
