import path from "node:path";
import process from "node:process";
import * as fsp from "node:fs/promises";
import "zx/globals";
import { collectChangedPaths } from "../../lib/build-system-test-scope";
import { runNodeWithZx } from "../../lib/node-run";
import { resolveToolPath } from "../../lib/tool-paths";

async function runVerifyFileSizePreflight(root: string, zxInitPath: string): Promise<void> {
  const script = path.resolve(root, "build-tools/tools/dev/file-size-lint.ts");
  const args = ["--scope=source", "--fail=true"];
  process.stderr.write("[verify] file-size preflight: running strict repo-owned file-size gate\n");
  try {
    await runNodeWithZx({ cwd: root, script, args, zxInitPath, stdio: "inherit" });
  } catch {
    process.stderr.write(
      "error: file-size preflight failed; split oversized files and re-run 'v'\n",
    );
    process.exit(2);
  }
}

async function runVerifyStaleNamesPreflight(root: string, zxInitPath: string): Promise<void> {
  const script = path.resolve(root, "build-tools/tools/dev/stale-names-lint.ts");
  process.stderr.write("[verify] stale-names preflight: scanning active source for stale names\n");
  try {
    await runNodeWithZx({ cwd: root, script, args: ["--full"], zxInitPath, stdio: "inherit" });
  } catch {
    process.stderr.write(
      "error: stale-names preflight failed; fix stale repo names, plan numbers, or migration labels and re-run 'v'\n",
    );
    process.exit(2);
  }
}

async function runVerifyNixGapsPolicyPreflight(root: string, zxInitPath: string): Promise<void> {
  const script = path.resolve(root, "build-tools/tools/dev/nix-gaps-inventory-check.ts");
  const args = [
    "--starlark-api",
    "docs/handbook/starlark-api.md",
    "--nix-gaps",
    "docs/handbook/nix-gaps.md",
    "--exceptions",
    "docs/handbook/nix-gaps-exceptions.json",
  ];
  process.stderr.write(
    "[verify] nix-gaps policy preflight: running inventory + exception checks\n",
  );
  try {
    await runNodeWithZx({ cwd: root, script, args, zxInitPath, stdio: "inherit" });
  } catch {
    process.stderr.write(
      "error: nix-gaps policy preflight failed; update docs/policy files and re-run 'v'\n",
    );
    process.exit(2);
  }
}

function normalizeRepoPath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
}

function shouldIgnoreLintPath(relPath: string): boolean {
  if (!relPath) return true;
  if (relPath.includes("/node_modules/") || relPath.startsWith("node_modules/")) return true;
  if (relPath.includes("/buck-out/") || relPath.startsWith("buck-out/")) return true;
  if (relPath.includes("/coverage/") || relPath.startsWith("coverage/")) return true;
  if (relPath.includes("/dist/") || relPath.startsWith("dist/")) return true;
  if (relPath.includes("/.clinic/") || relPath.startsWith(".clinic/")) return true;
  if (relPath.includes("/.vite-cache/") || relPath.startsWith(".vite-cache/")) return true;
  return false;
}

function isEslintPath(relPath: string): boolean {
  return relPath.endsWith(".ts") || relPath.endsWith(".tsx");
}

function isPrettierPath(relPath: string): boolean {
  return (
    relPath.endsWith(".ts") ||
    relPath.endsWith(".tsx") ||
    relPath.endsWith(".js") ||
    relPath.endsWith(".mjs") ||
    relPath.endsWith(".cjs") ||
    relPath.endsWith(".md") ||
    relPath.endsWith(".json") ||
    relPath.endsWith(".yml") ||
    relPath.endsWith(".yaml")
  );
}

async function pathIsFile(root: string, relPath: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(path.resolve(root, relPath));
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveRepoNodeBin(root: string, name: string): Promise<string> {
  const candidate = path.join(root, "node_modules", ".bin", name);
  try {
    await fsp.access(candidate);
    return candidate;
  } catch {
    process.stderr.write(
      `error: verify lint preflight requires ${name} at ${candidate}; run 'i' to provision repo dev tools before re-running 'v'\n`,
    );
    process.exit(2);
  }
}

async function resolveChangedLintPaths(root: string): Promise<string[]> {
  const changedPaths = await collectChangedPaths(root, process.env);
  const normalized = Array.from(
    new Set(changedPaths.map((p) => normalizeRepoPath(p)).filter((p) => !shouldIgnoreLintPath(p))),
  ).sort();
  if (normalized.length === 0) {
    return [];
  }

  const checks = await Promise.all(
    normalized.map(async (relPath) => [relPath, await pathIsFile(root, relPath)] as const),
  );
  return checks.filter(([, isFile]) => isFile).map(([relPath]) => `./${relPath}`);
}

export async function runVerifyLintPreflight(
  root: string,
  zxInitPath: string,
  opts: { lintFilters?: string[] | null; includeBuildSystemPolicy?: boolean } = {},
): Promise<void> {
  const includeBuildSystemPolicy = opts.includeBuildSystemPolicy !== false;
  const skipLint = (process.env.VERIFY_SKIP_LINT || "").trim() === "1";
  if (skipLint) {
    process.stderr.write("[verify] lint preflight: skipped (VERIFY_SKIP_LINT=1)\n");
    if (includeBuildSystemPolicy) {
      await runVerifyNixGapsPolicyPreflight(root, zxInitPath);
    } else {
      process.stderr.write(
        "[verify] nix-gaps policy preflight: skipped for non-build-system verify scope\n",
      );
    }
    return;
  }

  const timeoutSecs = Number((process.env.VERIFY_LINT_TIMEOUT_SECS || "600").trim());
  const secs = Number.isFinite(timeoutSecs) && timeoutSecs > 0 ? Math.floor(timeoutSecs) : 600;

  const lintFilters = Array.isArray(opts.lintFilters)
    ? opts.lintFilters.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const changedLintPaths = lintFilters.length > 0 ? [] : await resolveChangedLintPaths(root);
  const eslintTargets =
    lintFilters.length > 0 ? lintFilters : changedLintPaths.filter(isEslintPath);
  const prettierTargets =
    lintFilters.length > 0 ? lintFilters : changedLintPaths.filter(isPrettierPath);
  const scoped = lintFilters.length > 0 || changedLintPaths.length > 0;
  if (!scoped) {
    process.stderr.write("[verify] lint preflight: skipped (no changed lint/prettier files)\n");
  }
  const lintCmd = scoped
    ? `${eslintTargets.length > 0 ? `node_modules/.bin/eslint --no-warn-ignored ${eslintTargets.join(" ")} --ext .ts,.tsx --max-warnings=0 --ignore-pattern buck-out --ignore-pattern coverage --ignore-pattern .clinic --ignore-pattern '**/.vite-cache/**' && ` : ""}node_modules/.bin/prettier -c ${prettierTargets.join(" ")}`
    : "skip (no changed lint/prettier files)";
  process.stderr.write(`[verify] lint preflight: timeout -k 10s ${secs}s ${lintCmd}\n`);
  const timeoutPath = await resolveToolPath("timeout");
  const eslintPath =
    scoped && eslintTargets.length > 0 ? await resolveRepoNodeBin(root, "eslint") : "";
  const prettierPath =
    scoped && prettierTargets.length > 0 ? await resolveRepoNodeBin(root, "prettier") : "";

  const eslintRes =
    scoped && eslintTargets.length > 0
      ? await $({
          stdio: "inherit",
          cwd: root,
          reject: false,
        })`${timeoutPath} -k 10s ${secs}s ${eslintPath} --no-warn-ignored ${eslintTargets} --ext .ts,.tsx --max-warnings=0 --ignore-pattern buck-out --ignore-pattern coverage --ignore-pattern .clinic --ignore-pattern "**/.vite-cache/**"`
      : { exitCode: 0 };
  if (eslintRes.exitCode !== 0) {
    process.stderr.write(
      "error: lint preflight failed; refusing to run verify while formatting/lint is dirty\n" +
        "hint: run 'pnpm -s lint:fix' (or format the specific files), then re-run 'v'\n",
    );
    process.exit(2);
  }
  if (scoped && prettierTargets.length > 0) {
    const prettierRes = await $({
      stdio: "inherit",
      cwd: root,
      reject: false,
    })`${timeoutPath} -k 10s ${secs}s ${prettierPath} -c ${prettierTargets}`;
    if (prettierRes.exitCode !== 0) {
      process.stderr.write(
        "error: lint preflight failed; refusing to run verify while formatting/lint is dirty\n" +
          "hint: run 'pnpm -s lint:fix' (or format the specific files), then re-run 'v'\n",
      );
      process.exit(2);
    }
  }

  await runVerifyStaleNamesPreflight(root, zxInitPath);

  if (includeBuildSystemPolicy) {
    await runVerifyFileSizePreflight(root, zxInitPath);
    await runVerifyNixGapsPolicyPreflight(root, zxInitPath);
  } else {
    process.stderr.write(
      "[verify] file-size preflight: skipped build-system file-size gates for non-build-system verify scope\n",
    );
    process.stderr.write(
      "[verify] nix-gaps policy preflight: skipped for non-build-system verify scope\n",
    );
  }
}
