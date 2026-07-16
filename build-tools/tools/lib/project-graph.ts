import { packagePathFromLabel } from "./labels";
import { normalizeRepoPath } from "./repo-path";

export { normalizeRepoPath } from "./repo-path";

type GraphNodeLike = {
  name?: string;
  deps?: unknown;
};

export type ProjectGraph = {
  projects: string[];
  depsByProject: Map<string, Set<string>>;
  reverseDepsByProject: Map<string, Set<string>>;
};

export const DEFAULT_PROJECT_PREFIXES = ["projects/apps/", "projects/libs/"] as const;

function normalizedProjectPrefixes(projectPrefixes?: readonly string[]): string[] {
  const source =
    projectPrefixes && projectPrefixes.length > 0 ? projectPrefixes : DEFAULT_PROJECT_PREFIXES;
  return toSortedUnique(
    source
      .map((prefix) => normalizeRepoPath(prefix).replace(/^\/+/, "").replace(/\/+$/, ""))
      .filter(Boolean)
      .map((prefix) => `${prefix}/`),
  );
}

export function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

export function projectFromPackagePath(
  packagePath: string,
  projectPrefixes?: readonly string[],
): string | null {
  const normalized = normalizeRepoPath(packagePath).replace(/^\/+/, "");
  for (const prefix of normalizedProjectPrefixes(projectPrefixes)) {
    if (!normalized.startsWith(prefix)) continue;
    const projectName = normalized.slice(prefix.length).split("/")[0] || "";
    if (!projectName) return null;
    return `${prefix}${projectName}`;
  }
  return null;
}

export function projectFromRepoPath(
  relPath: string,
  projectPrefixes?: readonly string[],
): string | null {
  return projectFromPackagePath(normalizeRepoPath(relPath), projectPrefixes);
}

export function projectFromTargetLabel(
  label: string,
  projectPrefixes?: readonly string[],
): string | null {
  return projectFromPackagePath(packagePathFromLabel(label), projectPrefixes);
}

export function collectChangedProjects(
  changedPaths: string[],
  projectPrefixes?: readonly string[],
): string[] {
  return toSortedUnique(
    changedPaths
      .map((p) => projectFromRepoPath(p, projectPrefixes))
      .filter((x): x is string => !!x),
  );
}

export function toProjectTargets(projects: string[]): string[] {
  return toSortedUnique(projects.map((project) => `//${project}/...`));
}

function pushEdge(
  edgesByProject: Map<string, Set<string>>,
  fromProject: string,
  toProject: string,
): void {
  if (fromProject === toProject) return;
  let edges = edgesByProject.get(fromProject);
  if (!edges) {
    edges = new Set<string>();
    edgesByProject.set(fromProject, edges);
  }
  edges.add(toProject);
}

export function buildProjectGraph(
  nodes: GraphNodeLike[],
  projectPrefixes?: readonly string[],
): ProjectGraph {
  const projects = new Set<string>();
  const depsByProject = new Map<string, Set<string>>();
  const reverseDepsByProject = new Map<string, Set<string>>();

  for (const node of nodes) {
    const project = projectFromTargetLabel(String(node.name || ""), projectPrefixes);
    if (!project) continue;
    projects.add(project);
    const deps = Array.isArray(node.deps) ? node.deps : [];
    for (const dep of deps) {
      const dependencyProject = projectFromTargetLabel(String(dep || ""), projectPrefixes);
      if (!dependencyProject) continue;
      projects.add(dependencyProject);
      pushEdge(depsByProject, project, dependencyProject);
      pushEdge(reverseDepsByProject, dependencyProject, project);
    }
  }

  return {
    projects: toSortedUnique(projects),
    depsByProject,
    reverseDepsByProject,
  };
}

export function computeProjectClosure(
  seedProjects: string[],
  adjacencyByProject: Map<string, Set<string>>,
): string[] {
  const visited = new Set<string>(seedProjects);
  const queue = [...seedProjects];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const adjacent = adjacencyByProject.get(current);
    if (!adjacent) continue;
    for (const nextProject of adjacent) {
      if (visited.has(nextProject)) continue;
      visited.add(nextProject);
      queue.push(nextProject);
    }
  }
  return toSortedUnique(visited);
}
