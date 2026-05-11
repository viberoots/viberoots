#!/usr/bin/env zx-wrapper
/**
 * Fast repo-name, plan-number, and migration-label lint for staged files and full-source scans.
 *
 * Usage:
 *   node stale-names-lint.ts [--files <f1> <f2> ...]  # staged/explicit file list (pre-commit)
 *   node stale-names-lint.ts [--full]                 # full active-source scan (verify/CI)
 *   node stale-names-lint.ts [--fail]                 # exit non-zero on any hit (default: true)
 */
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getFlagBool, getPositionals } from "../lib/cli";

const execFileAsync = promisify(execFile);

// Files exempt from all checks.
const ALLOWED_PATHS = new Set([
  "build-tools/tools/dev/stale-names-lint.ts",
  "build-tools/tools/tests/linting/no-stale-viberoots-names.enforcement.test.ts",
  // Negative-path test asserting that old BNX_DEPLOY_CONTROL_PLANE_TOKEN is not accepted.
  "build-tools/tools/tests/deployments/nixos-shared-host.control-plane-service-env.test.ts",
  "docs/repo-rename.md",
  "docs/runtime-prefix-migration.md",
  "docs/contributor-naming-conventions.md",
  "mayday-test-time-debugging.md",
  "pnpm-lock.yaml",
]);

const ALLOWED_PREFIXES = [
  "docs/build-history/",
  "docs/design-history/",
  // third_party/uv2nix uses nixpkgs.legacyPackages which is a Nixpkgs API name (external).
  "third_party/uv2nix/",
];

const EXCLUDED_DIRS = new Set([
  ".git",
  ".direnv",
  "buck-out",
  "coverage",
  "node_modules",
  "result",
  "test-logs",
]);

// Stale repository-name patterns.
const REPO_NAME_PATTERNS: Array<{ re: RegExp; label: string }> = [
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
];

// Completed-plan/phase identifiers in active code.
// Matches .pr<N>. in file paths, "PR-<N>" in test descriptions/identifiers, and phase numbers.
// Does NOT match operational phase concepts like `phase0` in deployment context
// (those appear only in specific deployment paths that are excluded below).
const PLAN_NUMBER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /\.pr\d+\.(docs|service|errors|happy-path|helpers|test)\b/g,
    label: "completed-plan PR number in test file name (use behavior-based name)",
  },
  {
    // Matches "PR-N" as a word (in test descriptions, identifiers, etc.).
    // Does NOT match in doc files (.md/.rst) where PR-N is structural plan numbering.
    re: /\bPR-\d+\b/g,
    label: "completed-plan PR number in identifier or test description (use behavior-based name)",
  },
  {
    // Matches phase2, phase3 etc. as standalone identifiers.
    // Does NOT match phase2-a, phase2-b style test-data strings (the dash suffix is a qualifier).
    re: /\bphase[2-9](?![\w-])|\bphase[1-9]\d+(?![\w-])/g,
    label: "completed-plan phase number in identifier (use behavior-based name)",
  },
  {
    // Matches "Phase-N" (uppercase) as a completed plan reference in test descriptions.
    // Does NOT match in doc files (.md/.rst) where Phase-N is structural plan numbering.
    re: /\bPhase-[2-9]\b|\bPhase-[1-9]\d+\b/g,
    label: "completed-plan phase number in test description (use behavior-based name)",
  },
];

// Migration-label patterns. Only applied to repo-owned active source.
// Allowlisted contexts: external protocol paths (/v1, /v2, kv-v2), Vault, npm versions,
// Buck buck-out/v2, git porcelain, schema versions, and known intentional boundaries.
const MIGRATION_LABEL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /\blegacy[A-Z_][A-Za-z0-9_]*\b|\blegacy-[a-z]/g,
    label: "migration label: legacy* identifier (replace with behavior name or remove)",
  },
];

// Paths where plan-number enforcement is skipped (operational concepts that use numeric names).
const PLAN_NUMBER_SKIP_PATHS = new Set([
  "build-tools/tools/deployments/deployment-phase0-admission.ts",
  "build-tools/tools/deployments/deployment-phase0-prerequisite-chain.ts",
  "build-tools/tools/deployments/deployment-phase0-release.ts",
  "build-tools/tools/tests/deployments/deployment-phase0-admission.test.ts",
  "build-tools/tools/tests/deployments/deployment-phase0-release.test.ts",
  "build-tools/tools/tests/deployments/deployment-readiness-gates.phase0-access.fixture.ts",
  "build-tools/tools/tests/deployments/deployment-readiness-gates.phase0-access.test.ts",
  "build-tools/tools/tests/deployments/phase0-deployments.contract.test.ts",
  "build-tools/tools/tests/deployments/phase0-deployments.readiness-secrets.test.ts",
  "build-tools/tools/tests/deployments/phase0-deployments.smoke.test.ts",
  "build-tools/tools/nix/shared-host-identity-provider-migration.nix",
]);

function normalizeRel(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function isAllowedFile(rel: string): boolean {
  return ALLOWED_PATHS.has(rel) || ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

function isExcludedDir(relDir: string): boolean {
  return normalizeRel(relDir)
    .split("/")
    .filter(Boolean)
    .some((part) => EXCLUDED_DIRS.has(part));
}

function lineNumberForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return String(stdout || "")
      .split("\0")
      .filter(Boolean)
      .map((rel) => normalizeRel(rel))
      .sort();
  } catch {
    const files: string[] = [];
    const stack = [repoRoot];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const relDir = normalizeRel(path.relative(repoRoot, cur));
      if (isExcludedDir(relDir)) continue;
      for (const entry of await fsp.readdir(cur, { withFileTypes: true })) {
        const abs = path.join(cur, entry.name);
        if (entry.isDirectory()) {
          stack.push(abs);
        } else if (entry.isFile()) {
          files.push(normalizeRel(path.relative(repoRoot, abs)));
        }
      }
    }
    return files.sort();
  }
}

type Hit = { rel: string; line: number; label: string };

function isDocFile(rel: string): boolean {
  // Plan and design documents use PR-N headings as structural labels; skip
  // plan-number and migration-label checks for them.
  return rel.endsWith(".md") || rel.endsWith(".rst");
}

async function scanFile(repoRoot: string, rel: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  let text = "";
  try {
    text = await fsp.readFile(path.join(repoRoot, rel), "utf8");
  } catch {
    return hits;
  }
  for (const { re, label } of REPO_NAME_PATTERNS) {
    for (const m of text.matchAll(re)) {
      hits.push({ rel, line: lineNumberForOffset(text, m.index ?? 0), label });
    }
  }
  if (!isDocFile(rel) && !PLAN_NUMBER_SKIP_PATHS.has(rel)) {
    for (const { re, label } of PLAN_NUMBER_PATTERNS) {
      for (const m of text.matchAll(re)) {
        hits.push({ rel, line: lineNumberForOffset(text, m.index ?? 0), label });
      }
    }
  }
  if (!isDocFile(rel)) {
    for (const { re, label } of MIGRATION_LABEL_PATTERNS) {
      for (const m of text.matchAll(re)) {
        hits.push({ rel, line: lineNumberForOffset(text, m.index ?? 0), label });
      }
    }
  }
  return hits;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const failOnHits = !getFlagBool("no-fail");
  const positional = getPositionals();

  let relPaths: string[];
  if (positional.length > 0) {
    // Staged/explicit file mode (e.g. from lint-staged or --files list).
    relPaths = positional.map((f) => normalizeRel(path.relative(repoRoot, path.resolve(f))));
  } else {
    // Full active-source scan (verify/CI default).
    relPaths = await listTrackedFiles(repoRoot);
  }

  const hits: Hit[] = [];
  for (const rel of relPaths) {
    if (isAllowedFile(rel)) continue;
    const fileHits = await scanFile(repoRoot, rel);
    hits.push(...fileHits);
  }

  if (hits.length === 0) {
    process.stderr.write("[stale-names-lint] no stale names found\n");
    return;
  }

  const lines = [
    `[stale-names-lint] found ${hits.length} stale naming hit(s):`,
    ...hits.slice(0, 80).map((h) => `  ${h.rel}:${h.line} ${h.label}`),
    ...(hits.length > 80 ? [`  ... and ${hits.length - 80} more`] : []),
  ];
  process.stderr.write(lines.join("\n") + "\n");
  if (failOnHits) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[stale-names-lint] unexpected error: ${err?.message ?? err}\n`);
  process.exit(2);
});
