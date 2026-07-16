import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveSourceFileSizeExceptionPaths } from "./file-size-lint-exceptions";
import { listFilesMatching } from "./file-size-globs";
import {
  PROJECT_SOURCE_FILES_SCOPE,
  SOURCE_FILES_SCOPE,
  type FileSizeScope,
} from "./file-size-lint-scopes";

export type FileOffender = { file: string; lines: number };

function normalizeRelPath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

async function countLines(file: string): Promise<number> {
  try {
    const data = await fsp.readFile(file, "utf8");
    if (data.length === 0) return 0;
    const newlineCount = data.match(/\n/g)?.length ?? 0;
    return data.endsWith("\n") ? newlineCount : newlineCount + 1;
  } catch {
    return 0;
  }
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function scopeUsesFileSizeExceptions(scope: FileSizeScope): boolean {
  return (
    (sameList(scope.include, SOURCE_FILES_SCOPE.include) &&
      sameList(scope.exclude, SOURCE_FILES_SCOPE.exclude)) ||
    (sameList(scope.include, PROJECT_SOURCE_FILES_SCOPE.include) &&
      sameList(scope.exclude, PROJECT_SOURCE_FILES_SCOPE.exclude))
  );
}

export async function scanFileSizeOffenders(opts: {
  root: string;
  candidates: readonly string[];
  threshold: number;
  allowKnown: boolean;
  scope: FileSizeScope;
}): Promise<FileOffender[]> {
  const matches = await listFilesMatching({
    root: opts.root,
    include: opts.scope.include,
    exclude: opts.scope.exclude,
  });
  const inScope = new Set(matches.map(normalizeRelPath));
  const exceptions = new Set(
    scopeUsesFileSizeExceptions(opts.scope)
      ? await resolveSourceFileSizeExceptionPaths(opts.root)
      : [],
  );
  const offenders: FileOffender[] = [];
  for (const candidate of opts.candidates) {
    const rel = normalizeRelPath(candidate);
    if (!inScope.has(rel) || (!opts.allowKnown && exceptions.has(rel))) continue;
    const lines = await countLines(path.join(opts.root, rel));
    if (lines > opts.threshold) offenders.push({ file: rel, lines });
  }
  return offenders.sort((left, right) => right.lines - left.lines);
}
