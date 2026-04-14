import path from "node:path";
import * as fsp from "node:fs/promises";
import fg from "fast-glob";
import { normalizeRepoPath } from "../lib/project-graph.ts";

export const METHODOLOGY_EXCEPTIONS_FILENAME = "methodology-exceptions.json";
export const PROJECT_METHODOLOGY_EXCEPTIONS_FILENAME = METHODOLOGY_EXCEPTIONS_FILENAME;

type SourceFileSizeException = {
  path: string;
  justification: string;
};

type ProjectMethodologyExceptions = {
  sourceFileSizeExceptions?: SourceFileSizeException[];
};

const EXCEPTION_MANIFEST_IGNORE = [
  "buck-out/**",
  "node_modules/**",
  "coverage/**",
  "prelude/**",
  "docs/**",
  "build-tools/docs/**",
  "test-logs/**",
];

function resolveOwnerScopedPath(manifestPath: string, filePath: string): string {
  const ownerRoot = path.posix.dirname(normalizeRepoPath(manifestPath));
  if (!ownerRoot || ownerRoot === ".") {
    throw new Error(`${manifestPath}: methodology-exceptions.json must not live at repo root`);
  }
  const resolved = path.posix.normalize(`${ownerRoot}/${normalizeRepoPath(filePath)}`);
  if (!resolved.startsWith(`${ownerRoot}/`)) {
    throw new Error(
      `${manifestPath}: sourceFileSizeExceptions.path must stay within the owning subtree`,
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
  const manifests = await fg(`**/${METHODOLOGY_EXCEPTIONS_FILENAME}`, {
    cwd: root,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: EXCEPTION_MANIFEST_IGNORE,
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
      resolved.add(resolveOwnerScopedPath(manifestPath, entry.path));
    }
  }

  return [...resolved].sort();
}
