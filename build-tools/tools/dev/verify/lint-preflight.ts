import path from "node:path";
import process from "node:process";
import * as fsp from "node:fs/promises";
import fs from "node:fs";
import "zx/globals";
import { collectChangedPaths } from "../../lib/build-system-test-scope";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";
import { runNodeWithZx } from "../../lib/node-run";
import { repoNodeBinCandidates, resolveRepoNodeBin } from "../../lib/repo-node-bin";
import { resolveToolPath } from "../../lib/tool-paths";
import { buildToolsRoot, buildToolPath } from "../dev-build/paths";
import {
  filterExistingLintPreflightPaths,
  resolveLintPreflightFilterPaths,
} from "./lint-preflight-paths";

function verbose(): boolean {
  return isVbrVerbose();
}

function shouldRunBuildSystemPolicy(root: string): boolean {
  const toolsRoot = fs.realpathSync.native(path.resolve(buildToolsRoot(root)));
  const workspaceRoot = fs.realpathSync.native(path.resolve(root));
  return (
    toolsRoot === path.join(workspaceRoot, "build-tools") ||
    toolsRoot.startsWith(`${workspaceRoot}${path.sep}`)
  );
}

function printCapturedFailure(error: unknown): void {
  const err = error as { stdout?: unknown; stderr?: unknown };
  const details = [err?.stderr, err?.stdout]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  if (details) process.stderr.write(`${details}\n`);
}

async function firstExisting(root: string, relCandidates: string[]): Promise<string> {
  for (const rel of relCandidates) {
    const candidate = path.join(root, rel);
    try {
      await fsp.access(candidate);
      return rel;
    } catch {}
  }
  return relCandidates[0] || "";
}

async function runVerifyFileSizePreflight(
  root: string,
  zxInitPath: string,
  opts: { changedOnly?: boolean; zxNodeModulesOut?: string | null } = {},
): Promise<void> {
  const script = buildToolPath(root, "tools/dev/file-size-lint.ts");
  const args = ["--scope=source", "--fail=true"];
  if (opts.changedOnly) {
    args.push("--changed-only");
  }
  if (verbose()) {
    process.stderr.write(
      opts.changedOnly
        ? "[verify] file-size preflight: running changed-file source file-size gate\n"
        : "[verify] file-size preflight: running strict repo-owned file-size gate\n",
    );
  }
  try {
    await runNodeWithZx({
      cwd: root,
      script,
      args,
      zxInitPath,
      env: envWithZxNodeModules(opts.zxNodeModulesOut),
      stdio: verbose() ? "inherit" : "pipe",
    });
  } catch (error) {
    printCapturedFailure(error);
    process.stderr.write(
      "error: file-size preflight failed; split oversized files and re-run 'v'\n",
    );
    process.exit(2);
  }
}

function envWithZxNodeModules(zxNodeModulesOut?: string | null): NodeJS.ProcessEnv {
  const outPath = String(zxNodeModulesOut || "").trim();
  if (!outPath) return process.env;
  const nodeModules = path.join(outPath, "node_modules");
  return {
    ...process.env,
    ZX_TEST_NODE_MODULES_OUT: outPath,
    NODE_PATH: [nodeModules, process.env.NODE_PATH || ""].filter(Boolean).join(path.delimiter),
  };
}

async function runVerifyStaleNamesPreflight(
  root: string,
  zxInitPath: string,
  opts: { zxNodeModulesOut?: string | null } = {},
): Promise<void> {
  const script = buildToolPath(root, "tools/dev/stale-names-lint.ts");
  if (verbose()) {
    process.stderr.write(
      "[verify] stale-names preflight: scanning active source for stale names\n",
    );
  }
  try {
    await runNodeWithZx({
      cwd: root,
      script,
      args: ["--full"],
      zxInitPath,
      env: envWithZxNodeModules(opts.zxNodeModulesOut),
      stdio: verbose() ? "inherit" : "pipe",
    });
  } catch (error) {
    printCapturedFailure(error);
    process.stderr.write(
      "error: stale-names preflight failed; fix stale repo names, plan numbers, or migration labels and re-run 'v'\n",
    );
    process.exit(2);
  }
}

async function runVerifyNixGapsPolicyPreflight(
  root: string,
  zxInitPath: string,
  opts: { zxNodeModulesOut?: string | null } = {},
): Promise<void> {
  const script = buildToolPath(root, "tools/dev/nix-gaps-inventory-check.ts");
  const starlarkApi = await firstExisting(root, [
    "docs/handbook/starlark-api.md",
    "viberoots/docs/handbook/starlark-api.md",
  ]);
  const nixGaps = await firstExisting(root, [
    "docs/handbook/nix-gaps.md",
    "viberoots/docs/handbook/nix-gaps.md",
  ]);
  const exceptions = await firstExisting(root, [
    "docs/handbook/nix-gaps-exceptions.json",
    "viberoots/docs/handbook/nix-gaps-exceptions.json",
  ]);
  const args = ["--starlark-api", starlarkApi, "--nix-gaps", nixGaps, "--exceptions", exceptions];
  if (verbose()) {
    process.stderr.write(
      "[verify] nix-gaps policy preflight: running inventory + exception checks\n",
    );
  }
  try {
    await runNodeWithZx({
      cwd: root,
      script,
      args,
      zxInitPath,
      env: envWithZxNodeModules(opts.zxNodeModulesOut),
      stdio: verbose() ? "inherit" : "pipe",
    });
  } catch (error) {
    printCapturedFailure(error);
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
  if (relPath === "viberoots" || relPath === ".viberoots/current") return true;
  if (
    relPath === ".buckconfig" ||
    relPath === ".buckroot" ||
    relPath === ".envrc" ||
    relPath === ".gitignore" ||
    relPath === "projects" ||
    relPath === "projects/" ||
    relPath === "README.md" ||
    relPath === "projects/.metadata_never_index" ||
    relPath === "projects/AGENTS.md" ||
    relPath === "projects/README.md" ||
    relPath === "projects/config/README.md" ||
    relPath === "projects/config/shared.json"
  ) {
    return true;
  }
  if (relPath.includes("/node_modules/") || relPath.startsWith("node_modules/")) return true;
  if (relPath.includes("/buck-out/") || relPath.startsWith("buck-out/")) return true;
  if (relPath.includes("/coverage/") || relPath.startsWith("coverage/")) return true;
  if (relPath.includes("/dist/") || relPath.startsWith("dist/")) return true;
  if (relPath.includes("/.clinic/") || relPath.startsWith(".clinic/")) return true;
  if (relPath.includes("/.vite-cache/") || relPath.startsWith(".vite-cache/")) return true;
  if (relPath === ".direnv" || relPath.startsWith(".direnv/")) return true;
  if (relPath === ".nix-zsh" || relPath.startsWith(".nix-zsh/")) return true;
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

async function resolveVerifyNodeBin(root: string, name: string): Promise<string> {
  try {
    return await resolveRepoNodeBin(root, name);
  } catch {}
  const candidates = await repoNodeBinCandidates(root, name);
  process.stderr.write(
    `error: verify lint preflight requires ${name}; checked ${candidates.join(", ")} and PATH. Run 'i' to provision repo dev tools before re-running 'v'\n`,
  );
  process.exit(2);
}

async function resolveEslintConfig(root: string): Promise<string> {
  return path.join(
    root,
    await firstExisting(root, ["eslint.config.js", "viberoots/eslint.config.js"]),
  );
}

export async function runVerifyLintPreflight(
  root: string,
  zxInitPath: string,
  opts: {
    lintFilters?: string[] | null;
    includeBuildSystemPolicy?: boolean;
    zxNodeModulesOut?: string | null;
  } = {},
): Promise<void> {
  const ui = createCommandUi({ verbose: verbose() });
  const includeBuildSystemPolicy =
    opts.includeBuildSystemPolicy !== false && shouldRunBuildSystemPolicy(root);
  const skipLint = (process.env.VERIFY_SKIP_LINT || "").trim() === "1";
  if (skipLint) {
    process.stderr.write("[verify] lint preflight: skipped (VERIFY_SKIP_LINT=1)\n");
    if (includeBuildSystemPolicy) {
      await runVerifyNixGapsPolicyPreflight(root, zxInitPath, {
        zxNodeModulesOut: opts.zxNodeModulesOut,
      });
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
  const explicitLintPaths =
    lintFilters.length > 0
      ? (await resolveLintPreflightFilterPaths(root, lintFilters)).filter(
          (p) => p === "." || !shouldIgnoreLintPath(p),
        )
      : [];
  const fullRepoLintRequested = explicitLintPaths.includes(".");
  const rawChangedPaths =
    lintFilters.length > 0 ? [] : await collectChangedPaths(root, process.env);
  const normalizedChangedPaths = Array.from(
    new Set(rawChangedPaths.map((p) => normalizeRepoPath(p)).filter(Boolean)),
  ).sort();
  const existingChangedPaths =
    lintFilters.length > 0
      ? normalizedChangedPaths
      : await filterExistingLintPreflightPaths(root, normalizedChangedPaths);
  const changedLintPaths =
    lintFilters.length > 0 ? [] : existingChangedPaths.filter((p) => !shouldIgnoreLintPath(p));
  const onlyIgnoredScaffoldChanges =
    lintFilters.length === 0 && existingChangedPaths.length > 0 && changedLintPaths.length === 0;
  const eslintTargets =
    lintFilters.length > 0
      ? fullRepoLintRequested
        ? ["."]
        : explicitLintPaths.filter(isEslintPath)
      : changedLintPaths.filter(isEslintPath);
  const prettierTargets =
    lintFilters.length > 0
      ? fullRepoLintRequested
        ? ["."]
        : explicitLintPaths.filter(isPrettierPath)
      : changedLintPaths.filter(isPrettierPath);
  const scoped =
    (lintFilters.length > 0 && (eslintTargets.length > 0 || prettierTargets.length > 0)) ||
    changedLintPaths.length > 0;
  if (onlyIgnoredScaffoldChanges) {
    if (verbose()) {
      process.stderr.write(
        "[verify] lint preflight: skipped (only generated bootstrap scaffold files changed)\n",
      );
    }
    return;
  }
  if (!scoped) {
    if (verbose()) {
      process.stderr.write("[verify] lint preflight: skipped (no changed lint/prettier files)\n");
    }
  }
  const eslintConfig = scoped && eslintTargets.length > 0 ? await resolveEslintConfig(root) : "";
  const lintCmd = scoped
    ? `${eslintTargets.length > 0 ? `eslint --config ${path.relative(root, eslintConfig) || "."} --no-warn-ignored ${eslintTargets.join(" ")} --ext .ts,.tsx --max-warnings=0 --ignore-pattern buck-out --ignore-pattern coverage --ignore-pattern .clinic --ignore-pattern '**/.vite-cache/**' && ` : ""}prettier -c ${prettierTargets.join(" ")}`
    : "skip (no changed lint/prettier files)";
  if (verbose()) {
    process.stderr.write(`[verify] lint preflight: timeout -k 10s ${secs}s ${lintCmd}\n`);
  } else if (scoped) {
    ui.step("preflight", `lint/format ${eslintTargets.length + prettierTargets.length} files`);
  }
  const timeoutPath = await resolveToolPath("timeout");
  const eslintPath =
    scoped && eslintTargets.length > 0 ? await resolveVerifyNodeBin(root, "eslint") : "";
  const prettierPath =
    scoped && prettierTargets.length > 0 ? await resolveVerifyNodeBin(root, "prettier") : "";

  const eslintRes =
    scoped && eslintTargets.length > 0
      ? await $({
          stdio: verbose() ? "inherit" : "pipe",
          cwd: root,
          reject: false,
        })`${timeoutPath} -k 10s ${secs}s ${eslintPath} --config ${eslintConfig} --no-warn-ignored ${eslintTargets} --ext .ts,.tsx --max-warnings=0 --ignore-pattern buck-out --ignore-pattern coverage --ignore-pattern .clinic --ignore-pattern "**/.vite-cache/**"`
      : { exitCode: 0 };
  if (eslintRes.exitCode !== 0) {
    if (!verbose()) {
      process.stderr.write(String(eslintRes.stderr || eslintRes.stdout || ""));
    }
    process.stderr.write(
      "error: lint preflight failed; refusing to run verify while formatting/lint is dirty\n" +
        "hint: run 'pnpm -s lint:fix' (or format the specific files), then re-run 'v'\n",
    );
    process.exit(2);
  }
  if (scoped && prettierTargets.length > 0) {
    const prettierRes = await $({
      stdio: verbose() ? "inherit" : "pipe",
      cwd: root,
      reject: false,
    })`${timeoutPath} -k 10s ${secs}s ${prettierPath} -c ${prettierTargets}`;
    if (prettierRes.exitCode !== 0) {
      if (!verbose()) {
        process.stderr.write(String(prettierRes.stderr || prettierRes.stdout || ""));
      }
      process.stderr.write(
        "error: lint preflight failed; refusing to run verify while formatting/lint is dirty\n" +
          "hint: run 'pnpm -s lint:fix' (or format the specific files), then re-run 'v'\n",
      );
      process.exit(2);
    }
  }

  await runVerifyStaleNamesPreflight(root, zxInitPath, {
    zxNodeModulesOut: opts.zxNodeModulesOut,
  });

  await runVerifyFileSizePreflight(root, zxInitPath, {
    changedOnly: !includeBuildSystemPolicy,
    zxNodeModulesOut: opts.zxNodeModulesOut,
  });

  if (includeBuildSystemPolicy) {
    await runVerifyNixGapsPolicyPreflight(root, zxInitPath, {
      zxNodeModulesOut: opts.zxNodeModulesOut,
    });
  } else {
    if (verbose()) {
      process.stderr.write(
        "[verify] nix-gaps policy preflight: skipped for non-build-system verify scope\n",
      );
    }
  }
}
