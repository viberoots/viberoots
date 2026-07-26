const RAW_TEMP_RE = /\b(?:fsp|fs)\.mkdtemp\s*\(/;
const INHERITED_ISOLATION_RE = /\binheritedBuckIsolation\s*\(/;
const BUCK_COMMAND_RE = /\bbuck2\b[\s\S]{0,500}?--isolation-dir\b/;
const KILL_REPO_RE = /\bkillBuckDaemonsForRepo\s*\(/;
const REMOVE_TEMP_RE = /\b(?:fsp|fs)\.rm\s*\(/;
const MODULE_ISOLATION_RE =
  /^const\s+([A-Za-z_$][\w$]*[Ii]solation[A-Za-z0-9_$]*)\s*=\s*inheritedBuckIsolation\s*\(/gm;
const INLINE_FIXED_ISOLATION_RE =
  /\bbuck2\b[\s\S]{0,500}?--isolation-dir\s+\\?\$\{inheritedBuckIsolation\s*\(\s*["']([^"']+)["']\s*\)\}/g;

export type BuckIsolationLifetimeViolation = {
  line: number;
  reason: string;
};

function lineNumberAt(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function regexEscape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function testSections(text: string): Array<{ text: string; start: number }> {
  const starts = [...text.matchAll(/^test\s*\(/gm)].map((match) => match.index ?? 0);
  return starts.map((start, index) => ({
    start,
    text: text.slice(start, starts[index + 1] ?? text.length),
  }));
}

export function findBuckIsolationLifetimeViolations(
  text: string,
): BuckIsolationLifetimeViolation[] {
  const violations: BuckIsolationLifetimeViolation[] = [];

  for (const section of testSections(text)) {
    if (
      !RAW_TEMP_RE.test(section.text) ||
      !INHERITED_ISOLATION_RE.test(section.text) ||
      !BUCK_COMMAND_RE.test(section.text)
    ) {
      continue;
    }
    const killOffset = section.text.search(KILL_REPO_RE);
    const removeOffset = section.text.search(REMOVE_TEMP_RE);
    if (killOffset < 0 || removeOffset < 0 || killOffset > removeOffset) {
      violations.push({
        line: lineNumberAt(text, section.start),
        reason: "a raw temporary Buck repo must kill all repo daemons before its recursive removal",
      });
    }
  }

  for (const match of text.matchAll(MODULE_ISOLATION_RE)) {
    const isolation = match[1]!;
    const escaped = regexEscape(isolation);
    const usedByBuck = new RegExp(
      `\\bbuck2\\b[\\s\\S]{0,500}?--isolation-dir\\s+\\\\?\\$\\{${escaped}\\}`,
    ).test(text);
    if (!usedByBuck) continue;
    const exactAfterCleanup = new RegExp(
      `\\bafter\\s*\\([\\s\\S]{0,300}?\\bkillBuckIsolation\\s*\\(\\s*process\\.cwd\\(\\)\\s*,\\s*${escaped}\\s*\\)`,
    ).test(text);
    if (!exactAfterCleanup) {
      violations.push({
        line: lineNumberAt(text, match.index ?? 0),
        reason: `module-scoped Buck isolation '${isolation}' needs exact after-hook cleanup`,
      });
    }
  }

  if (!RAW_TEMP_RE.test(text) && !/\brunInTemp\s*\(/.test(text)) {
    for (const match of text.matchAll(INLINE_FIXED_ISOLATION_RE)) {
      const literal = match[1]!;
      const exactAfterCleanup = new RegExp(
        `\\bafter\\s*\\([\\s\\S]{0,300}?\\bkillBuckIsolation\\s*\\(\\s*process\\.cwd\\(\\)\\s*,\\s*inheritedBuckIsolation\\s*\\(\\s*["']${regexEscape(literal)}["']\\s*\\)\\s*\\)`,
      ).test(text);
      if (!exactAfterCleanup) {
        violations.push({
          line: lineNumberAt(text, match.index ?? 0),
          reason: `inline Buck isolation '${literal}' needs exact after-hook cleanup`,
        });
      }
    }
  }

  return violations;
}
