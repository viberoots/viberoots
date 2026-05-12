import * as fsp from "node:fs/promises";
import path from "node:path";

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
const BUCK_ISO_RE = /\bbuck2\b[\s\S]{0,600}?--isolation-dir\b/g;
const APPROVED_INHERITED_ISO_RE = /\binheritedBuckIsolation\s*\(|\bBUCK_NESTED_ISO\b/;
const IDENTIFIER_RE = "[A-Za-z_$][\\w$]*";
export const ALLOW_COMMENT = "lint: allow-hardcoded-buck-isolation";

export type IsolationViolation = { line: number; reason: string };

export function normalizeRelPath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function allowCommentLineHasJustification(line: string): boolean {
  if (!line.includes(ALLOW_COMMENT)) return false;
  const idx = line.indexOf(ALLOW_COMMENT);
  if (idx < 0) return false;
  const suffix = line
    .slice(idx + ALLOW_COMMENT.length)
    .replace(/^[:\s-]+/, "")
    .trim();
  return suffix.length >= 12;
}

function lineNumberAt(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function contextFor(text: string, offset: number, linesBefore = 2, linesAfter = 8): string {
  const starts = lineStartOffsets(text);
  const line = lineNumberAt(text, offset) - 1;
  const start = starts[Math.max(0, line - linesBefore)] ?? 0;
  const endLine = Math.min(starts.length - 1, line + linesAfter);
  const end = starts[endLine + 1] ?? text.length;
  return text.slice(start, end);
}

function maskLineComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf("//");
      if (idx < 0) return line;
      return `${line.slice(0, idx)}${" ".repeat(line.length - idx)}`;
    })
    .join("\n");
}

function regexEscape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isApprovedRegisteredHelper(relPath: string, context: string): boolean {
  if (
    relPath === "build-tools/tools/tests/lib/test-helpers.ts" &&
    /ownedBuckIsolations|cleanupOwnedBuckIsolationsSync/.test(context)
  ) {
    return true;
  }
  return (
    relPath === "build-tools/tools/tests/lib/test-helpers/run-in-temp.ts" &&
    /createTempBuck2Shim|real_buck2/.test(context)
  );
}

export function collectIsolationFragmentHelpers(text: string): string[] {
  const helpers = new Set<string>();
  const masked = maskLineComments(text);
  const patterns = [
    new RegExp(
      `\\bfunction\\s+(${IDENTIFIER_RE})\\s*\\([^)]*\\)[^{]*{[\\s\\S]{0,700}?--isolation-dir[\\s\\S]{0,700}?}`,
      "g",
    ),
    new RegExp(
      `\\b(?:export\\s+)?(?:const|let)\\s+(${IDENTIFIER_RE})\\s*=\\s*(?:\\([^)]*\\)|${IDENTIFIER_RE})\\s*(?::\\s*[^=;{]+)?=>[\\s\\S]{0,500}?--isolation-dir`,
      "g",
    ),
  ];
  for (const re of patterns) {
    for (const match of masked.matchAll(re)) {
      const snippet = match[0] ?? "";
      if (!/\bbuck2\b/.test(snippet)) helpers.add(match[1]!);
    }
  }
  return [...helpers].sort();
}

function helperFragmentMatches(text: string, helperNames: string[]): RegExpMatchArray[] {
  if (helperNames.length === 0) return [];
  const names = helperNames.map(regexEscape).join("|");
  const helperCallRe = new RegExp(`\\bbuck2\\b[\\s\\S]{0,400}\\b(?:${names})\\s*\\(`, "g");
  return [...text.matchAll(helperCallRe)];
}

export function findExplicitIsolationViolations(
  text: string,
  relPath = "fixture.ts",
  isolationFragmentHelpers: string[] = [],
): IsolationViolation[] {
  const hits: IsolationViolation[] = [];
  for (const match of maskLineComments(text).matchAll(BUCK_ISO_RE)) {
    const offset = match.index ?? 0;
    const context = contextFor(text, offset);
    if (APPROVED_INHERITED_ISO_RE.test(context)) continue;
    if (isApprovedRegisteredHelper(relPath, context)) continue;
    const allowLine = context.split(/\r?\n/).find((line) => line.includes(ALLOW_COMMENT));
    if (allowLine) {
      if (!allowCommentLineHasJustification(allowLine)) {
        hits.push({
          line: lineNumberAt(text, offset),
          reason: "allow comment needs a justification",
        });
      }
      continue;
    }
    hits.push({
      line: lineNumberAt(text, offset),
      reason: "use the registered runInTemp buck isolation",
    });
  }
  for (const match of helperFragmentMatches(maskLineComments(text), isolationFragmentHelpers)) {
    const offset = match.index ?? 0;
    const context = contextFor(text, offset);
    if (APPROVED_INHERITED_ISO_RE.test(context)) continue;
    const allowLine = context.split(/\r?\n/).find((line) => line.includes(ALLOW_COMMENT));
    if (allowLine) {
      if (!allowCommentLineHasJustification(allowLine)) {
        hits.push({
          line: lineNumberAt(text, offset),
          reason: "allow comment needs a justification",
        });
      }
      continue;
    }
    hits.push({
      line: lineNumberAt(text, offset),
      reason: "helper returns an explicit buck isolation fragment",
    });
  }
  return hits;
}

export async function collectIsolationFragmentHelpersForFiles(files: string[]): Promise<string[]> {
  const helpers = new Set<string>();
  for (const file of files) {
    const text = await fsp.readFile(file, "utf8");
    for (const helper of collectIsolationFragmentHelpers(text)) helpers.add(helper);
  }
  return [...helpers].sort();
}

async function listTsFiles(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [path.join(repoRoot, "build-tools", "tools", "tests")];
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

function localImportSpecifiers(text: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["'](\.[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) specs.add(match[1]!);
  }
  return [...specs].sort();
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

  const queue = files.filter((file) => RUN_IN_TEMP_RE.test(textByFile.get(file) ?? ""));
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i += 1) {
    const file = queue[i]!;
    for (const spec of localImportSpecifiers(textByFile.get(file) ?? "")) {
      const next = resolveLocalImport(file, spec, known);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
