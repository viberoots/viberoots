import * as fsp from "node:fs/promises";
const BUCK_ISO_RE = /\bbuck2\b(?=\s|`|["']\s*,)(?:(?!\bbuck2\b)[\s\S]){0,600}?--isolation-dir\b/g;
const APPROVED_INHERITED_ISO_RE = /\binheritedBuckIsolation\s*\(|\bBUCK_NESTED_ISO\b/;
const APPROVED_INHERITED_ENV_RE = /\bBUCK_(?:NESTED_ISO|ISOLATION_DIR(?:_EXPORTER)?)\b/;
const IDENTIFIER_RE = "[A-Za-z_$][\\w$]*";
export const ALLOW_COMMENT = "lint: allow-hardcoded-buck-isolation";

export type IsolationViolation = { line: number; reason: string };
type CommandRange = { text: string; start: number };

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

function nearestBefore(text: string, offset: number, needle: string): number {
  return text.lastIndexOf(needle, offset);
}

function commandRangeForOffset(text: string, offset: number): CommandRange {
  const lineStart = text.lastIndexOf("\n", offset) + 1;
  const lineEndIdx = text.indexOf("\n", offset);
  const lineEnd = lineEndIdx < 0 ? text.length : lineEndIdx;
  const templateStart = nearestBefore(text, offset, "`");
  const arrayStart = nearestBefore(text, offset, "[");

  if (templateStart >= 0) {
    const templateEnd = text.indexOf("`", offset);
    if (templateEnd >= 0)
      return { text: text.slice(templateStart, templateEnd + 1), start: templateStart };
  }

  if (arrayStart >= 0) {
    const arrayEnd = text.indexOf("]", offset);
    if (arrayEnd >= 0) return { text: text.slice(arrayStart, arrayEnd + 1), start: arrayStart };
  }

  return { text: text.slice(lineStart, lineEnd), start: lineStart };
}

function commandForOffset(text: string, offset: number): string {
  return commandRangeForOffset(text, offset).text;
}

function firstCommandStartOnLine(text: string, lineStart: number): number {
  const lineEndIdx = text.indexOf("\n", lineStart);
  const lineEnd = lineEndIdx < 0 ? text.length : lineEndIdx;
  const line = text.slice(lineStart, lineEnd);
  const starts = ["`", "["]
    .map((needle) => line.indexOf(needle))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b);
  return lineStart + (starts[0] ?? 0);
}

function commandHasApprovedInheritedIsolation(text: string, offset: number): boolean {
  return APPROVED_INHERITED_ISO_RE.test(commandForOffset(text, offset));
}

function allowCommentForCommand(text: string, offset: number): string | undefined {
  const command = commandRangeForOffset(text, offset);
  if (command.text.includes(ALLOW_COMMENT)) return command.text;
  const prevLineEnd = text.lastIndexOf("\n", Math.max(0, text.lastIndexOf("\n", offset) - 1));
  const commandLineStart = text.lastIndexOf("\n", offset) + 1;
  const prevLine = text.slice(prevLineEnd + 1, Math.max(0, commandLineStart - 1));
  return prevLine.trimStart().startsWith("//") &&
    prevLine.includes(ALLOW_COMMENT) &&
    command.start === firstCommandStartOnLine(text, commandLineStart)
    ? prevLine
    : undefined;
}

function maskLineComments(text: string): string {
  let masked = "";
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  for (let idx = 0; idx < text.length; idx += 1) {
    const ch = text[idx]!;
    const next = text[idx + 1];

    if (quote === undefined && ch === "/" && next === "/") {
      const end = text.indexOf("\n", idx);
      const commentEnd = end < 0 ? text.length : end;
      masked += " ".repeat(commentEnd - idx);
      idx = commentEnd - 1;
      continue;
    }

    masked += ch;
    if (escaped) {
      escaped = false;
    } else if (quote !== undefined && ch === "\\") {
      escaped = true;
    } else if (quote !== undefined && ch === quote) {
      quote = undefined;
    } else if (quote === undefined && (ch === "'" || ch === '"' || ch === "`")) {
      quote = ch;
    }
  }
  return masked;
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
      if (APPROVED_INHERITED_ENV_RE.test(snippet)) continue;
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
    if (isApprovedRegisteredHelper(relPath, context)) continue;
    if (commandHasApprovedInheritedIsolation(text, offset)) continue;
    const allowLine = allowCommentForCommand(text, offset);
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
    if (commandHasApprovedInheritedIsolation(text, offset)) continue;
    const allowLine = allowCommentForCommand(text, offset);
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
