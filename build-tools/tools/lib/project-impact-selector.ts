import path from "node:path";
import { readGraph } from "./graph.ts";
import { DEFAULT_GRAPH_PATH } from "./graph-const.ts";
import { packagePathFromLabel } from "./labels.ts";

type GraphNodeLike = {
  name?: string;
  deps?: unknown;
};

export type ProjectImpactSelectorMode =
  | "project-impact"
  | "no-project-impact"
  | "fallback-build-system-scope";

export type ProjectImpactSelectorDiagnostics = {
  mode: ProjectImpactSelectorMode;
  changedPaths: string[];
  changedProjects: string[];
  dependentProjects: string[];
  selectedTargets: string[];
  reason: string;
};

export type ProjectImpactSelectorResult = {
  mode: ProjectImpactSelectorMode;
  targets: string[];
  diagnostics: ProjectImpactSelectorDiagnostics;
};

const PROJECT_PREFIXES = ["projects/apps/", "projects/libs/"] as const;

function normalizePath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
}

function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

function projectFromPackagePath(packagePath: string): string | null {
  const normalized = normalizePath(packagePath).replace(/^\/+/, "");
  for (const prefix of PROJECT_PREFIXES) {
    if (!normalized.startsWith(prefix)) continue;
    const tail = normalized.slice(prefix.length);
    const projectName = tail.split("/")[0] || "";
    if (!projectName) return null;
    return `${prefix}${projectName}`;
  }
  return null;
}

function projectFromRepoPath(relPath: string): string | null {
  return projectFromPackagePath(normalizePath(relPath));
}

function projectFromTargetLabel(label: string): string | null {
  return projectFromPackagePath(packagePathFromLabel(label));
}

function collectChangedProjects(changedPaths: string[]): string[] {
  return toSortedUnique(
    changedPaths.map((p) => projectFromRepoPath(p)).filter((x): x is string => !!x),
  );
}

function toProjectTargets(projects: string[]): string[] {
  return toSortedUnique(projects.map((p) => `//${p}/...`));
}

function pushEdge(
  reverseDepsByProject: Map<string, Set<string>>,
  dependencyProject: string,
  dependentProject: string,
): void {
  if (dependencyProject === dependentProject) return;
  let dependents = reverseDepsByProject.get(dependencyProject);
  if (!dependents) {
    dependents = new Set<string>();
    reverseDepsByProject.set(dependencyProject, dependents);
  }
  dependents.add(dependentProject);
}

function reverseDepsFromGraphNodes(nodes: GraphNodeLike[]): Map<string, Set<string>> {
  const reverseDepsByProject = new Map<string, Set<string>>();
  for (const node of nodes) {
    const dependentProject = projectFromTargetLabel(String(node.name || ""));
    if (!dependentProject) continue;
    const deps = Array.isArray(node.deps) ? node.deps : [];
    for (const dep of deps) {
      const dependencyProject = projectFromTargetLabel(String(dep || ""));
      if (!dependencyProject) continue;
      pushEdge(reverseDepsByProject, dependencyProject, dependentProject);
    }
  }
  return reverseDepsByProject;
}

function computeDependentProjectClosure(
  changedProjects: string[],
  reverseDepsByProject: Map<string, Set<string>>,
): string[] {
  const visited = new Set<string>(changedProjects);
  const queue = [...changedProjects];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const dependents = reverseDepsByProject.get(current);
    if (!dependents) continue;
    for (const dependent of dependents) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      queue.push(dependent);
    }
  }
  return toSortedUnique(
    Array.from(visited).filter((project) => !changedProjects.includes(project)),
  );
}

function noImpactResult(changedPaths: string[]): ProjectImpactSelectorResult {
  return {
    mode: "no-project-impact",
    targets: [],
    diagnostics: {
      mode: "no-project-impact",
      changedPaths,
      changedProjects: [],
      dependentProjects: [],
      selectedTargets: [],
      reason: "no-project-owned-file-changes",
    },
  };
}

function fallbackResult(
  changedPaths: string[],
  changedProjects: string[],
  reason: string,
): ProjectImpactSelectorResult {
  return {
    mode: "fallback-build-system-scope",
    targets: [],
    diagnostics: {
      mode: "fallback-build-system-scope",
      changedPaths,
      changedProjects,
      dependentProjects: [],
      selectedTargets: [],
      reason,
    },
  };
}

export async function resolveProjectImpactSelection(opts: {
  root: string;
  changedPaths: string[];
  graphPath?: string;
}): Promise<ProjectImpactSelectorResult> {
  const changedPaths = toSortedUnique(opts.changedPaths.map((p) => normalizePath(p)));
  const changedProjects = collectChangedProjects(changedPaths);
  if (changedProjects.length === 0) {
    return noImpactResult(changedPaths);
  }

  const graphPath = opts.graphPath || path.join(opts.root, DEFAULT_GRAPH_PATH);
  let nodes: GraphNodeLike[];
  try {
    nodes = (await readGraph(graphPath)) as GraphNodeLike[];
  } catch {
    return fallbackResult(changedPaths, changedProjects, "graph-read-failed");
  }

  const reverseDepsByProject = reverseDepsFromGraphNodes(nodes || []);
  const dependentProjects = computeDependentProjectClosure(changedProjects, reverseDepsByProject);
  const selectedTargets = toProjectTargets([...changedProjects, ...dependentProjects]);
  return {
    mode: "project-impact",
    targets: selectedTargets,
    diagnostics: {
      mode: "project-impact",
      changedPaths,
      changedProjects,
      dependentProjects,
      selectedTargets,
      reason: "project-impact-selection",
    },
  };
}
