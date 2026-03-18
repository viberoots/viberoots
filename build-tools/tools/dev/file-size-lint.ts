#!/usr/bin/env zx-wrapper
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fsp from "node:fs/promises";
import fg from "fast-glob";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli.ts";
import {
  SOURCE_FILES_SCOPE,
  SSR_TEST_FILES_SCOPE,
  type FileSizeScope,
} from "./file-size-lint-scopes.ts";
import { resolveSourceFileSizeExceptionPaths } from "./file-size-lint-exceptions.ts";
type Options = {
  root: string;
  changedOnly: boolean;
  threshold: number;
  failOnOffenders: boolean;
  allowKnown: boolean;
  scope: FileSizeScope;
};
export { SOURCE_FILES_SCOPE, SSR_TEST_FILES_SCOPE, type FileSizeScope };

function normalizeRelPath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function parseArgs(): Options {
  const root = path.resolve(getFlagStr("root", process.cwd()));
  const changedOnly = getFlagBool("changed-only") || getFlagBool("changedOnly");
  const threshold = Number(getFlagStr("threshold", "250"));
  const failOnOffenders = getFlagBool("fail");
  const allowKnown = getFlagBool("allow-known");
  const scopeName = getFlagStr("scope", "");
  const include = getFlagList("include");
  const exclude = getFlagList("exclude");

  if (scopeName === "source") {
    return {
      root,
      changedOnly,
      threshold,
      failOnOffenders,
      allowKnown,
      scope: {
        include: include.length ? include : SOURCE_FILES_SCOPE.include,
        exclude: exclude.length ? exclude : SOURCE_FILES_SCOPE.exclude,
      },
    };
  }
  if (scopeName === "ssr-tests") {
    return {
      root,
      changedOnly,
      threshold,
      failOnOffenders,
      allowKnown: false,
      scope: {
        include: include.length ? include : SSR_TEST_FILES_SCOPE.include,
        exclude: exclude.length ? exclude : SSR_TEST_FILES_SCOPE.exclude,
      },
    };
  }

  const legacyExts = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".bzl", ".nix"]);
  const legacyInclude =
    include.length > 0 ? include : Array.from(legacyExts).map((ext) => `**/*${ext}`);

  return {
    root,
    changedOnly,
    threshold,
    failOnOffenders,
    allowKnown,
    scope: { include: legacyInclude, exclude },
  };
}

async function listTrackedFilesFromRoot(root: string): Promise<string[]> {
  const $root = $({ cwd: root });
  try {
    const { stdout } = await $root`git ls-files -z`;
    return String(stdout || "")
      .split("\0")
      .filter(Boolean)
      .map(normalizeRelPath);
  } catch {
    const result: string[] = [];
    const ignore = new Set([
      ".git",
      "buck-out",
      "node_modules",
      "coverage",
      ".clinic",
      ".direnv",
      "result",
    ]);
    async function walk(dir: string) {
      let entries: any[] = [];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        const rel = normalizeRelPath(path.relative(root, abs));
        if (e.isDirectory()) {
          if (ignore.has(e.name)) continue;
          await walk(abs);
        } else {
          result.push(rel);
        }
      }
    }
    await walk(root);
    return result;
  }
}

async function listChangedFilesFromRoot(root: string): Promise<string[]> {
  const $root = $({ cwd: root });
  try {
    const { stdout } = await $root`git diff --name-only --diff-filter=AMR HEAD -z`;
    const changed = String(stdout || "")
      .split("\0")
      .filter(Boolean);
    if (changed.length > 0) return changed;
  } catch {}
  return listTrackedFilesFromRoot(root);
}

async function countLines(file: string): Promise<number> {
  try {
    const data = await fsp.readFile(file, "utf8");
    if (data.length === 0) return 0;
    const newlineCount = data.match(/\n/g)?.length ?? 0;
    const endsWithNewline = data.endsWith("\n");
    return endsWithNewline ? newlineCount : newlineCount + 1;
  } catch {
    return 0;
  }
}

export type FileOffender = { file: string; lines: number };

async function listScopeMatches(root: string, scope: FileSizeScope): Promise<Set<string>> {
  const matches = await fg(scope.include, {
    cwd: root,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: scope.exclude,
  });
  return new Set(matches.map(normalizeRelPath));
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSourceFileScope(scope: FileSizeScope): boolean {
  return (
    sameList(scope.include, SOURCE_FILES_SCOPE.include) &&
    sameList(scope.exclude, SOURCE_FILES_SCOPE.exclude)
  );
}

export async function findFileSizeOffenders(opts: Options): Promise<FileOffender[]> {
  const root = opts.root;
  const base = opts.changedOnly
    ? await listChangedFilesFromRoot(root)
    : await listTrackedFilesFromRoot(root);
  const inScope = await listScopeMatches(root, opts.scope);
  const projectExceptions = new Set(
    isSourceFileScope(opts.scope) ? await resolveSourceFileSizeExceptionPaths(root) : [],
  );

  const offenders: FileOffender[] = [];
  for (const rel of base) {
    if (!inScope.has(rel)) continue;
    if (!opts.allowKnown && projectExceptions.has(rel)) continue;
    const abs = path.join(root, rel);
    const lines = await countLines(abs);
    if (lines > opts.threshold) offenders.push({ file: rel, lines });
  }
  return offenders.sort((a, b) => b.lines - a.lines);
}

function splitKnownOffenders(
  offenders: FileOffender[],
  known: ReadonlyArray<string>,
): { unknown: FileOffender[]; known: FileOffender[] } {
  const knownSet = new Set(known);
  const outKnown: FileOffender[] = [];
  const outUnknown: FileOffender[] = [];
  for (const o of offenders) {
    if (knownSet.has(o.file)) outKnown.push(o);
    else outUnknown.push(o);
  }
  return { unknown: outUnknown, known: outKnown };
}

async function runCli() {
  const opts = parseArgs();
  const offenders = await findFileSizeOffenders(opts);
  if (offenders.length === 0) return;
  const knownPaths = isSourceFileScope(opts.scope)
    ? await resolveSourceFileSizeExceptionPaths(opts.root)
    : [];
  const { unknown, known } = opts.allowKnown
    ? splitKnownOffenders(offenders, knownPaths)
    : { unknown: offenders, known: [] as FileOffender[] };

  if (known.length > 0) {
    const knownLines = known.map(({ file, lines }) => `  ${file}: ${lines} lines`).join("\n");
    console.warn(
      `file-size-lint: known offenders (${known.length}) exceed ${opts.threshold} LOC\n${knownLines}`,
    );
  }

  if (unknown.length === 0) return;
  const header = `file-size-lint: ${unknown.length} file(s) exceed ${opts.threshold} LOC`;
  const lines = unknown.map(({ file, lines }) => `  ${file}: ${lines} lines`).join("\n");
  if (!opts.failOnOffenders) {
    console.warn(header + " (warn-only)\n" + lines);
    return;
  }
  console.error(header + " (fail)\n" + lines);
  process.exit(2);
}

function isMain(): boolean {
  try {
    const self = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
    return invoked === self;
  } catch {
    return true;
  }
}

if (isMain()) {
  runCli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
