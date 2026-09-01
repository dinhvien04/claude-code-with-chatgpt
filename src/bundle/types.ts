export interface PlanBundleOptions {
  workspaceRoot: string;
  goal: string;
  taskId?: string;
  files?: string[];
  maxDepth?: number;
  maxTreeEntries?: number;
  maxTotalBytes?: number;
}

export interface ReviewBundleOptions {
  workspaceRoot: string;
  taskId: string;
  iteration: number;
  diffMode?: "unstaged" | "staged" | "head";
  includeOutput?: boolean;
  outputId?: number;
  maxTotalBytes?: number;
}

export interface BundleResult {
  state: "INIT_P" | "EXECUTED_P";
  taskId: string;
  iteration: number;
  text: string;
  sizeBytes: number;
  truncated: boolean;
  warnings: string[];
}
