import { packagePathFromLabel } from "./labels.ts";

type GraphNodeLike = {
  name?: string;
  deps?: unknown;
};

export type ProjectGraph = {
  projects: string[];
  depsByProject: Map<string, Set<string>>;
  reverseDepsByProject: Map<string, Set<string>>;
};

const PROJECT_PREFIXES = ["projects/apps/", "projects/libs/"] as const;

export function normalizeRepoPath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
}

export function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

export function projectFromPackagePath(packagePath: string): string | null {
  const normalized = normalizeRepoPath(packagePath).replace(/^\/+/, "");
  for (const prefix of PROJECT_PREFIXES) {
    if (!normalized.startsWith(prefix)) continue;
    const projectName = normalized.slice(prefix.length).split("/")[0] || "";
    if (!projectName) return null;
    return `${prefix}${projectName}`;
  }
  return null;
}

export function projectFromRepoPath(relPath: string): string | null {
  return projectFromPackagePath(normalizeRepoPath(relPath));
}

export function projectFromTargetLabel(label: string): string | null {
  return projectFromPackagePath(packagePathFromLabel(label));
}

export function collectChangedProjects(changedPaths: string[]): string[] {
  return toSortedUnique(
    changedPaths.map((p) => projectFromRepoPath(p)).filter((x): x is string => !!x),
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

export function buildProjectGraph(nodes: GraphNodeLike[]): ProjectGraph {
  const projects = new Set<string>();
  const depsByProject = new Map<string, Set<string>>();
  const reverseDepsByProject = new Map<string, Set<string>>();

  for (const node of nodes) {
    const project = projectFromTargetLabel(String(node.name || ""));
    if (!project) continue;
    projects.add(project);
    const deps = Array.isArray(node.deps) ? node.deps : [];
    for (const dep of deps) {
      const dependencyProject = projectFromTargetLabel(String(dep || ""));
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
