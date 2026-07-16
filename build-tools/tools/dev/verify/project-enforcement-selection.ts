import { collectChangedPaths, type ChangedPathsResult } from "../../lib/build-system-test-scope";

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
  changeAuthorityFailure?: string;
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

export async function resolveProjectEnforcementSelection(opts: {
  root: string;
  requestedTargets: readonly string[];
  fullSuite: boolean;
  env?: NodeJS.ProcessEnv;
  collectChangedPaths?: typeof collectChangedPaths;
  changedPathsResult?: ChangedPathsResult;
}): Promise<ProjectEnforcementSelection> {
  if (opts.fullSuite) return { required: true, reason: "full-suite", changedPaths: [] };
  if (opts.requestedTargets.some(isExplicitProjectSelector)) {
    return { required: true, reason: "explicit-project-selector", changedPaths: [] };
  }
  const result =
    opts.changedPathsResult ||
    (await (opts.collectChangedPaths || collectChangedPaths)(opts.root, opts.env || process.env));
  if (!result.ok) {
    return {
      required: true,
      reason: "unavailable-change-authority",
      changedPaths: [],
      changeAuthorityFailure: result.reason,
    };
  }
  return result.paths.some(isProjectPath)
    ? { required: true, reason: "project-change", changedPaths: result.paths }
    : { required: false, reason: "not-required", changedPaths: result.paths };
}

export function injectProjectEnforcementTarget(
  targets: readonly string[],
  selection: ProjectEnforcementSelection,
): string[] {
  if (!selection.required) return [...targets];
  return Array.from(new Set([...targets, PROJECT_ENFORCEMENT_TARGETS]));
}
