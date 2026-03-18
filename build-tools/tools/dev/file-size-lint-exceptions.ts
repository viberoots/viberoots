import path from "node:path";
import * as fsp from "node:fs/promises";
import fg from "fast-glob";
import { DEFAULT_PROJECT_PREFIXES, normalizeRepoPath } from "../lib/project-graph.ts";

export const PROJECT_METHODOLOGY_EXCEPTIONS_FILENAME = "methodology-exceptions.json";

type SourceFileSizeException = {
  path: string;
  justification: string;
};

type ProjectMethodologyExceptions = {
  sourceFileSizeExceptions?: SourceFileSizeException[];
};

function projectExceptionManifestPatterns(): string[] {
  return DEFAULT_PROJECT_PREFIXES.map(
    (prefix) => `${prefix.slice(0, -1)}/*/${PROJECT_METHODOLOGY_EXCEPTIONS_FILENAME}`,
  );
}

function resolveProjectScopedPath(manifestPath: string, filePath: string): string {
  const projectRoot = path.posix.dirname(normalizeRepoPath(manifestPath));
  const resolved = path.posix.normalize(`${projectRoot}/${normalizeRepoPath(filePath)}`);
  if (!resolved.startsWith(`${projectRoot}/`)) {
    throw new Error(
      `${manifestPath}: sourceFileSizeExceptions.path must stay within the owning project`,
    );
  }
  return resolved;
}

async function readProjectMethodologyExceptions(
  root: string,
  manifestPath: string,
): Promise<ProjectMethodologyExceptions> {
  const manifestAbs = path.resolve(root, manifestPath);
  const parsed = JSON.parse(await fsp.readFile(manifestAbs, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${manifestPath}: expected a JSON object`);
  }
  return parsed as ProjectMethodologyExceptions;
}

export async function resolveSourceFileSizeExceptionPaths(root: string): Promise<string[]> {
  const manifests = await fg(projectExceptionManifestPatterns(), {
    cwd: root,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
  });
  const resolved = new Set<string>();

  for (const manifestPath of manifests.map((value) => normalizeRepoPath(value)).sort()) {
    const parsed = await readProjectMethodologyExceptions(root, manifestPath);
    const exceptions = parsed.sourceFileSizeExceptions ?? [];
    if (!Array.isArray(exceptions)) {
      throw new Error(`${manifestPath}: sourceFileSizeExceptions must be an array`);
    }
    for (const entry of exceptions) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.path !== "string" ||
        !entry.path.trim() ||
        typeof entry.justification !== "string" ||
        !entry.justification.trim()
      ) {
        throw new Error(
          `${manifestPath}: each sourceFileSizeExceptions entry needs path and justification`,
        );
      }
      resolved.add(resolveProjectScopedPath(manifestPath, entry.path));
    }
  }

  return [...resolved].sort();
}
