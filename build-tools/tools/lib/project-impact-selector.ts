import path from "node:path";
import { readGraph } from "./graph";
import { DEFAULT_GRAPH_PATH } from "./graph-const";
import {
  buildProjectGraph,
  collectChangedProjects,
  computeProjectClosure,
  normalizeRepoPath,
  toProjectTargets,
  toSortedUnique,
} from "./project-graph";

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
  projectPrefixes?: readonly string[];
}): Promise<ProjectImpactSelectorResult> {
  const changedPaths = toSortedUnique(opts.changedPaths.map((p) => normalizeRepoPath(p)));
  const changedProjects = collectChangedProjects(changedPaths, opts.projectPrefixes);
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

  const graph = buildProjectGraph(nodes || [], opts.projectPrefixes);
  const closure = computeProjectClosure(changedProjects, graph.reverseDepsByProject);
  const dependentProjects = closure.filter((project) => !changedProjects.includes(project));
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
