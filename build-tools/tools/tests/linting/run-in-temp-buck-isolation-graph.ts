import * as fsp from "node:fs/promises";
import path from "node:path";
import { normalizeRelPath } from "./run-in-temp-buck-isolation-lint.ts";

const EXCLUDED_DIRS = new Set([
  ".git",
  ".direnv",
  "buck-out",
  "node_modules",
  "coverage",
  "result",
  "test-logs",
]);

const RUN_IN_TEMP_RE = /\brunIn(?:Scratch)?Temp\s*\(/;
const BUCK_COMMAND_RE = /\bbuck2\b|--isolation-dir\b|BUCK_NESTED_ISO|BUCK_ISOLATION_DIR/;
type LocalImport = {
  spec: string;
  locals: string[];
  importNames: string[];
  exportedNames: string[];
  reexportAll: boolean;
};

async function listTsFiles(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [path.join(repoRoot, "build-tools", "tools")];
  while (stack.length) {
    const cur = stack.pop()!;
    const relDir = normalizeRelPath(path.relative(repoRoot, cur));
    if (relDir.split("/").some((part) => EXCLUDED_DIRS.has(part))) continue;
    let entries: Array<any> = [];
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true } as any);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      if (entry.isFile() && entry.name.endsWith(".ts")) out.push(abs);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function localImports(text: string): LocalImport[] {
  const imports = new Map<
    string,
    { locals: Set<string>; importNames: Set<string>; exportedNames: Set<string>; all: boolean }
  >();
  const add = (
    spec: string,
    local = "",
    importName = local,
    exportedName = "",
    all = false,
  ): void => {
    const cur = imports.get(spec) ?? {
      locals: new Set<string>(),
      importNames: new Set<string>(),
      exportedNames: new Set<string>(),
      all: false,
    };
    if (local) cur.locals.add(local);
    if (importName) cur.importNames.add(importName);
    if (exportedName) cur.exportedNames.add(exportedName);
    cur.all ||= all;
    imports.set(spec, cur);
  };
  for (const match of text.matchAll(/\bimport\s+([^"']+?)\s+from\s+["'](\.[^"']+)["']/g)) {
    const clause = match[1] ?? "";
    const spec = match[2]!;
    const named = clause.match(/{([^}]+)}/)?.[1] ?? "";
    for (const part of named.split(",")) {
      const [importName, local = importName] = part.trim().split(/\s+as\s+/);
      if (importName?.trim()) add(spec, local.trim(), importName.trim());
    }
    const defaultName = clause
      .replace(/{[^}]*}/g, "")
      .split(",")[0]
      ?.trim();
    if (defaultName && !defaultName.startsWith("*")) add(spec, defaultName);
    const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1];
    if (namespace) add(spec, namespace);
  }
  for (const match of text.matchAll(/\bexport\s+{([^}]+)}\s+from\s+["'](\.[^"']+)["']/g)) {
    const spec = match[2]!;
    for (const part of (match[1] ?? "").split(",")) {
      const [local, exportedName = local] = part.trim().split(/\s+as\s+/);
      if (local?.trim()) add(spec, local.trim(), local.trim(), exportedName.trim());
    }
  }
  for (const match of text.matchAll(/\bexport\s+\*\s+from\s+["'](\.[^"']+)["']/g)) {
    add(match[1]!, "", "", "", true);
  }
  for (const match of text.matchAll(/\b(?:import|export)\s+["'](\.[^"']+)["']/g)) add(match[1]!);
  return [...imports.entries()]
    .map(([spec, info]) => ({
      spec,
      locals: [...info.locals].sort(),
      importNames: [...info.importNames].sort(),
      exportedNames: [...info.exportedNames].sort(),
      reexportAll: info.all,
    }))
    .sort((a, b) => a.spec.localeCompare(b.spec));
}

function runInTempBodies(text: string): string {
  const bodies: string[] = [];
  for (const match of text.matchAll(/\brunIn(?:Scratch)?Temp\s*\(/g)) {
    let depth = 0;
    let started = false;
    for (let i = match.index ?? 0; i < text.length; i += 1) {
      if (text[i] === "(") {
        started = true;
        depth += 1;
      }
      if (text[i] === ")") depth -= 1;
      if (started && depth === 0) {
        bodies.push(text.slice(match.index, i + 1));
        break;
      }
    }
  }
  return bodies.join("\n");
}

function identifierUsed(text: string, id: string): boolean {
  return new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

function exportedFunctionBodiesUsing(text: string, usedExports: string[]): string {
  const bodies: string[] = [];
  for (const name of usedExports) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const functionRe = new RegExp(
      `\\b(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\b[\\s\\S]{0,800}?}`,
      "g",
    );
    const arrowRe = new RegExp(
      `\\b(?:export\\s+)?const\\s+${escaped}\\b[\\s\\S]{0,800}?^\\s*};?`,
      "gm",
    );
    const expressionArrowRe = new RegExp(
      `\\b(?:export\\s+)?const\\s+${escaped}\\b[\\s\\S]{0,400}?=>[\\s\\S]{0,400}?;`,
      "g",
    );
    for (const match of text.matchAll(functionRe)) bodies.push(match[0] ?? "");
    for (const match of text.matchAll(arrowRe)) bodies.push(match[0] ?? "");
    for (const match of text.matchAll(expressionArrowRe)) bodies.push(match[0] ?? "");
  }
  return bodies.join("\n");
}

function resolveLocalImport(
  fromFile: string,
  spec: string,
  knownFiles: Set<string>,
): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, path.join(base, "index.ts")];
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

export async function collectRunInTempScanFiles(repoRoot: string): Promise<string[]> {
  const files = await listTsFiles(repoRoot);
  const known = new Set(files);
  const textByFile = new Map<string, string>();
  for (const file of files) textByFile.set(file, await fsp.readFile(file, "utf8"));

  const testRoot = normalizeRelPath(path.join("build-tools", "tools", "tests"));
  const queue = files.filter((file) => {
    const rel = normalizeRelPath(path.relative(repoRoot, file));
    return rel.startsWith(`${testRoot}/`) && RUN_IN_TEMP_RE.test(textByFile.get(file) ?? "");
  });
  const seen = new Set(queue);
  const returned = new Set(queue);
  const usedExportsByFile = new Map<string, Set<string>>();
  const wildcardExportsByFile = new Set<string>();
  for (let i = 0; i < queue.length; i += 1) {
    const file = queue[i]!;
    const relFile = normalizeRelPath(path.relative(repoRoot, file));
    const isCurrentTestFile = relFile.startsWith(`${testRoot}/`);
    const fileText = textByFile.get(file) ?? "";
    const wildcardCurrent = wildcardExportsByFile.has(file);
    const activeExports = usedExportsByFile.get(file) ?? new Set<string>();
    const usedText = isCurrentTestFile
      ? runInTempBodies(fileText)
      : wildcardCurrent
        ? fileText
        : exportedFunctionBodiesUsing(fileText, [...activeExports]);
    for (const { spec, locals, importNames, exportedNames, reexportAll } of localImports(
      fileText,
    )) {
      const next = resolveLocalImport(file, spec, known);
      if (!next) continue;
      const rel = normalizeRelPath(path.relative(repoRoot, next));
      const isTestFile = rel.startsWith(`${testRoot}/`);
      const reexportParticipates =
        (reexportAll && (wildcardCurrent || activeExports.size > 0)) ||
        exportedNames.some(
          (id) => wildcardCurrent || activeExports.has(id) || identifierUsed(usedText, id),
        );
      const participates =
        reexportParticipates ||
        locals.length === 0 ||
        locals.some((id) => identifierUsed(usedText, id));
      if (isTestFile || participates) {
        const newlySeen = !seen.has(next);
        seen.add(next);
        const usedExports = usedExportsByFile.get(next) ?? new Set<string>();
        let addedExport = false;
        const wildcardNext = (reexportAll && wildcardCurrent) || wildcardExportsByFile.has(next);
        if (reexportAll && wildcardCurrent) wildcardExportsByFile.add(next);
        for (const importName of importNames) {
          if (!usedExports.has(importName)) addedExport = true;
          usedExports.add(importName);
        }
        if (reexportAll && !wildcardCurrent) {
          for (const local of activeExports) {
            if (!usedExports.has(local)) addedExport = true;
            usedExports.add(local);
          }
        }
        if (usedExports.size > 0) usedExportsByFile.set(next, usedExports);
        if (
          isTestFile ||
          BUCK_COMMAND_RE.test(
            wildcardNext
              ? (textByFile.get(next) ?? "")
              : exportedFunctionBodiesUsing(textByFile.get(next) ?? "", [...usedExports]),
          )
        ) {
          returned.add(next);
        }
        if (newlySeen || addedExport || wildcardNext) queue.push(next);
      }
    }
  }
  return [...returned].sort((a, b) => a.localeCompare(b));
}
