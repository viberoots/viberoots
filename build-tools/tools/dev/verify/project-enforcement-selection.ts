import { spawnSync } from "node:child_process";
import { collectChangedPaths } from "../../lib/build-system-test-scope";

export const PROJECT_ENFORCEMENT_TARGETS = "workspace_buck//...";

export type ProjectEnforcementSelectionReason =
  | "project-change"
  | "explicit-project-selector"
  | "full-suite"
  | "unavailable-change-authority"
  | "not-required";

export type ProjectEnforcementSelection = {
  required: boolean;
  reason: ProjectEnforcementSelectionReason;
  changedPaths: string[];
};

function normalizePath(value: string): string {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .trim();
}

export function isProjectPath(value: string): boolean {
  const rel = normalizePath(value);
  return rel === "projects" || rel.startsWith("projects/");
}

export function isExplicitProjectSelector(value: string): boolean {
  const target = String(value || "")
    .trim()
    .replace(/^root/, "");
  return (
    target === "//projects" || target.startsWith("//projects/") || target.startsWith("//projects:")
  );
}

function assertChangeAuthority(root: string): void {
  for (const args of [
    ["rev-parse", "--is-inside-work-tree"],
    ["status", "--porcelain=v1", "--untracked-files=no"],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  }
}

export async function resolveProjectEnforcementSelection(opts: {
  root: string;
  requestedTargets: readonly string[];
  fullSuite: boolean;
  env?: NodeJS.ProcessEnv;
  collectChangedPaths?: typeof collectChangedPaths;
}): Promise<ProjectEnforcementSelection> {
  if (opts.fullSuite) return { required: true, reason: "full-suite", changedPaths: [] };
  if (opts.requestedTargets.some(isExplicitProjectSelector)) {
    return { required: true, reason: "explicit-project-selector", changedPaths: [] };
  }
  try {
    if (!opts.collectChangedPaths) assertChangeAuthority(opts.root);
    const changedPaths = await (opts.collectChangedPaths || collectChangedPaths)(
      opts.root,
      opts.env || process.env,
    );
    return changedPaths.some(isProjectPath)
      ? { required: true, reason: "project-change", changedPaths }
      : { required: false, reason: "not-required", changedPaths };
  } catch {
    return { required: true, reason: "unavailable-change-authority", changedPaths: [] };
  }
}

export function injectProjectEnforcementTarget(
  targets: readonly string[],
  selection: ProjectEnforcementSelection,
): string[] {
  if (!selection.required) return [...targets];
  return Array.from(new Set([...targets, PROJECT_ENFORCEMENT_TARGETS]));
}
