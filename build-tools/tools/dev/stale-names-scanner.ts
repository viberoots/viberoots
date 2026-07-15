import path from "node:path";
import {
  ALLOWED_PATHS,
  ALLOWED_PREFIXES,
  MIGRATION_LABEL_SKIP_PATHS,
  PLAN_NUMBER_SKIP_PATHS,
  PLAN_NUMBER_SKIP_PREFIXES,
} from "./stale-names-lint-allowlists";

export type StaleNameHit = { rel: string; line: number; label: string };

type Pattern = { re: RegExp; label: string };
const retiredTerm = ["secret", "spec"].join("");
const retiredTitle = "Secret" + "spec";

const REPO_PATTERNS: Pattern[] = [
  { re: /\bbucknix\b/g, label: "stale name: bucknix" },
  { re: /\bBucknix\b/g, label: "stale name: Bucknix" },
  { re: /\bBUCKNIX\b/g, label: "stale name: BUCKNIX" },
  { re: /\bbucknix-fresh\b/g, label: "stale name: bucknix-fresh" },
  { re: /\bkiltyj\/bucknix-fresh\b/g, label: "stale name: kiltyj/bucknix-fresh" },
  { re: /git@github\.com:kiltyj\/bucknix-fresh\.git/g, label: "stale name: old repo remote" },
  { re: /(^|[^A-Za-z0-9])bnx(?=[^A-Za-z0-9]|$)/g, label: "stale name: bnx" },
  { re: /(^|[^A-Za-z0-9])Bnx(?=[^A-Za-z0-9]|$)/g, label: "stale name: Bnx" },
  { re: /(^|[^A-Za-z0-9])BNX(?=[^A-Za-z0-9]|$)/g, label: "stale name: BNX" },
  { re: /\/srv\/common\b/g, label: "stale name: /srv/common deployment path" },
  { re: /\bkiltyj\/common\b/g, label: "stale name: kiltyj/common" },
  { re: /git@github\.com:kiltyj\/common\.git/g, label: "stale name: old common repo remote" },
  { re: /\bkiltyj\/viberoots\b/g, label: "stale name: kiltyj/viberoots" },
  { re: /git@github\.com:kiltyj\/viberoots\.git/g, label: "stale name: old viberoots repo remote" },
  {
    re: new RegExp(`\\b${retiredTerm}\\b`, "g"),
    label: "stale name: retired input-contract term (use SprinkleRef)",
  },
  {
    re: new RegExp(`\\b${retiredTitle}\\b`, "g"),
    label: "stale name: retired title-case input-contract term (use SprinkleRef)",
  },
];

const PLAN_PATTERNS: Pattern[] = [
  {
    re: /(^|[\/._-])pr\d+(?=$|[\/._-])/g,
    label: "completed-plan PR number in file path or identifier (use behavior-based name)",
  },
  {
    re: /\.pr\d+\.(docs|service|errors|happy-path|helpers|test)\b/g,
    label: "completed-plan PR number in test file name (use behavior-based name)",
  },
  {
    re: /\bPR-\d+\b/g,
    label: "completed-plan PR number in identifier or test description (use behavior-based name)",
  },
  {
    re: /\bphase\d+(?![\w-])/g,
    label: "completed-plan phase number in identifier (use behavior-based name)",
  },
  {
    re: /\bPhase-\d+\b/g,
    label: "completed-plan phase number in test description (use behavior-based name)",
  },
];

const MIGRATION_PATTERNS: Pattern[] = [
  {
    re: /\blegacy[A-Z_][A-Za-z0-9_]*\b|\blegacy-[a-z]/g,
    label: "migration label: legacy* identifier (replace with behavior name or remove)",
  },
  {
    re: /\b(?:v[12]_?[A-Za-z][A-Za-z0-9_]*|[A-Za-z][A-Za-z0-9_]*_v[12]|[a-z][A-Za-z0-9]*V[12]|[A-Z][A-Za-z0-9]*V[12])\b/g,
    label: "migration label: internal v1/v2 identifier (use canonical behavior name)",
  },
];

const OPAQUE_EXTENSIONS = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".otf",
  ".pdf",
  ".png",
  ".ttf",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
]);

export function normalizeStaleNamePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function isAllowedStaleNamePath(rel: string): boolean {
  return (
    ALLOWED_PATHS.has(rel) ||
    rel.endsWith("pnpm-lock.yaml") ||
    ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))
  );
}

function skipsPlanNumbers(rel: string): boolean {
  return (
    PLAN_NUMBER_SKIP_PATHS.has(rel) ||
    rel.endsWith("/opentofu/stack.json") ||
    PLAN_NUMBER_SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))
  );
}

function isDocCommand(text: string, offset: number): boolean {
  const before = text.slice(0, offset).split("\n");
  const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
  if (!line || line.startsWith("#") || line.startsWith("```")) return false;
  let fenced = false;
  for (const prior of before.slice(0, -1)) if (/^\s*```/.test(prior)) fenced = !fenced;
  if (fenced) return true;
  return (
    /^\$|^>|^\.(?:\/|\s)|^[A-Za-z_]\w*=|^(?:env|cd|make|bash|sh|python|python3|ruby|task|npm|yarn|node|pnpm|v|i|b|scaf|deploy|buck2|nix|git)\b/.test(
      line,
    ) ||
    (/^(?:[A-Za-z_]\w*=\S+\s+)*[A-Za-z][\w.-]*(?:\s+|$)/.test(line) &&
      /(?:^|\s)(?:\.{0,2}\/|[\w./-]+\.(?:bash|bzl|cjs|js|mjs|nix|py|rb|sh|ts|tsx)|run\b|exec\b|test\b|--?[\w-]+|&&|\|\||[|;])/.test(
        line,
      ))
  );
}

function matches(
  rel: string,
  text: string,
  patterns: readonly Pattern[],
  docsOnlyWhenCommand: boolean,
): StaleNameHit[] {
  const hits: StaleNameHit[] = [];
  const isDoc = rel.endsWith(".md") || rel.endsWith(".rst");
  for (const { re, label } of patterns) {
    for (const match of text.matchAll(re)) {
      const offset = match.index ?? 0;
      if (docsOnlyWhenCommand && isDoc && !isDocCommand(text, offset)) continue;
      hits.push({ rel, line: text.slice(0, offset).split("\n").length, label });
    }
  }
  return hits;
}

export function scanStaleNameEntry(opts: {
  rel: string;
  text: string;
  migrationLabelSkipPaths?: ReadonlySet<string>;
}): StaleNameHit[] {
  const rel = normalizeStaleNamePath(opts.rel);
  if (isAllowedStaleNamePath(rel)) return [];
  const migrationSkips = opts.migrationLabelSkipPaths || MIGRATION_LABEL_SKIP_PATHS;
  const pathPatterns = [
    ...REPO_PATTERNS,
    ...(!skipsPlanNumbers(rel) ? PLAN_PATTERNS : []),
    ...(!migrationSkips.has(rel) ? MIGRATION_PATTERNS : []),
  ];
  const hits = matches(rel, rel, pathPatterns, false).map((hit) => ({ ...hit, line: 1 }));
  if (OPAQUE_EXTENSIONS.has(path.extname(rel).toLowerCase())) return hits;
  hits.push(...matches(rel, opts.text, REPO_PATTERNS, false));
  if (!skipsPlanNumbers(rel)) hits.push(...matches(rel, opts.text, PLAN_PATTERNS, true));
  if (!migrationSkips.has(rel)) hits.push(...matches(rel, opts.text, MIGRATION_PATTERNS, true));
  return hits;
}
