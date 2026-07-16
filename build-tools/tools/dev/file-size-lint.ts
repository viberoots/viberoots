#!/usr/bin/env zx-wrapper
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  PROJECT_SOURCE_FILES_SCOPE,
  SOURCE_FILES_SCOPE,
  type FileSizeScope,
} from "./file-size-lint-scopes";
import { resolveSourceFileSizeExceptionPaths } from "./file-size-lint-exceptions";
import {
  scanFileSizeOffenders,
  scopeUsesFileSizeExceptions,
  type FileOffender,
} from "./file-size-scanner";
import {
  parseFileSizeLintArgs,
  type FileSizeLintOptions as Options,
} from "./file-size-lint-options";
export { PROJECT_SOURCE_FILES_SCOPE, SOURCE_FILES_SCOPE, type FileSizeScope };
export type { FileOffender } from "./file-size-scanner";

const execFileAsync = promisify(execFile);

function normalizeRelPath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

async function listSourceFilesFromRoot(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
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
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-only", "--diff-filter=AMR", "HEAD", "-z"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    const changed = String(stdout || "")
      .split("\0")
      .filter(Boolean);
    if (changed.length > 0) return changed;
  } catch {}
  return listSourceFilesFromRoot(root);
}

export async function findFileSizeOffenders(opts: Options): Promise<FileOffender[]> {
  const root = opts.root;
  const base = opts.changedOnly
    ? await listChangedFilesFromRoot(root)
    : await listSourceFilesFromRoot(root);
  return await scanFileSizeOffenders({
    root,
    candidates: base,
    threshold: opts.threshold,
    allowKnown: opts.allowKnown,
    scope: opts.scope,
  });
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
  const opts = parseFileSizeLintArgs();
  const offenders = await findFileSizeOffenders(opts);
  if (offenders.length === 0) return;
  const knownPaths = scopeUsesFileSizeExceptions(opts.scope)
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
    return invoked === self || path.basename(invoked) === path.basename(self);
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
