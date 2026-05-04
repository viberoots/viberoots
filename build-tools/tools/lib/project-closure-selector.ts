import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "./graph-const";
import { readGraph } from "./graph";
import {
  buildProjectGraph,
  computeProjectClosure,
  normalizeRepoPath,
  projectFromPackagePath,
  toProjectTargets,
  toSortedUnique,
} from "./project-graph";

export type ProjectClosureSelectorDiagnostics = {
  mode: "project-closure";
  requestedProjects: string[];
  resolvedDependencyClosure: string[];
  selectedTargets: string[];
  fallbackReason?: string;
};

export type ProjectClosureSelectorResult = {
  mode: "project-closure";
  targets: string[];
  diagnostics: ProjectClosureSelectorDiagnostics;
};

function canonicalProjectId(raw: string, projectPrefixes?: readonly string[]): string | null {
  const normalized = normalizeRepoPath(raw).replace(/^\/+/, "").replace(/\/+$/, "");
  const project = projectFromPackagePath(normalized, projectPrefixes);
  if (!project) return null;
  return project === normalized ? project : null;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let nextDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const saved = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, nextDiag + cost);
      nextDiag = saved;
    }
  }
  return prev[b.length];
}

function suggestionScore(input: string, candidate: string): number {
  const baseInput = input.split("/").filter(Boolean).at(-1) || input;
  const baseCandidate = candidate.split("/").filter(Boolean).at(-1) || candidate;
  if (candidate === input) return 0;
  if (candidate.endsWith(`/${input}`) || candidate.endsWith(`/${baseInput}`)) return 1;
  if (baseCandidate === baseInput) return 2;
  if (candidate.includes(input) || candidate.includes(baseInput)) return 3;
  return 10 + levenshteinDistance(input, candidate);
}

function nearestProjectSuggestions(input: string, knownProjects: string[]): string[] {
  return knownProjects
    .map((candidate) => ({ candidate, score: suggestionScore(input, candidate) }))
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map((entry) => entry.candidate);
}

function invalidProjectError(
  raw: string,
  knownProjects: string[],
  projectPrefixes?: readonly string[],
): Error {
  const normalized = normalizeRepoPath(raw).replace(/^\/+/, "").replace(/\/+$/, "");
  const suggestions = nearestProjectSuggestions(normalized, knownProjects);
  const examplePrefix = String(projectPrefixes?.[0] || "projects/apps").replace(/\/+$/, "");
  const example = `${examplePrefix}/foo`;
  const lines = [
    `unknown project identifier: ${raw}`,
    `project-closure requires canonical repo-relative project paths like ${example}`,
  ];
  if (suggestions.length > 0) {
    lines.push(`did you mean: ${suggestions.join(", ")}`);
  }
  return new Error(lines.join("\n"));
}

function validateRequestedProjects(
  requestedProjects: string[],
  knownProjects: string[],
  projectPrefixes?: readonly string[],
): string[] {
  const known = new Set(knownProjects);
  const canonical: string[] = [];
  for (const project of requestedProjects) {
    const resolved = canonicalProjectId(project, projectPrefixes);
    if (!resolved) throw invalidProjectError(project, knownProjects, projectPrefixes);
    canonical.push(resolved);
  }
  for (const project of canonical) {
    if (known.has(project)) continue;
    throw invalidProjectError(project, knownProjects, projectPrefixes);
  }
  return toSortedUnique(canonical);
}

export async function resolveProjectClosureSelection(opts: {
  root: string;
  requestedProjects: string[];
  graphPath?: string;
  projectPrefixes?: readonly string[];
}): Promise<ProjectClosureSelectorResult> {
  const graphPath = opts.graphPath || path.join(opts.root, DEFAULT_GRAPH_PATH);
  const graph = buildProjectGraph(await readGraph(graphPath), opts.projectPrefixes);
  const requestedProjects = validateRequestedProjects(
    opts.requestedProjects,
    graph.projects,
    opts.projectPrefixes,
  );
  const resolvedDependencyClosure = computeProjectClosure(requestedProjects, graph.depsByProject);
  const selectedTargets = toProjectTargets(resolvedDependencyClosure);
  return {
    mode: "project-closure",
    targets: selectedTargets,
    diagnostics: {
      mode: "project-closure",
      requestedProjects,
      resolvedDependencyClosure,
      selectedTargets,
    },
  };
}
