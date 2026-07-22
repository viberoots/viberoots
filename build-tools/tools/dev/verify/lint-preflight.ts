import path from "node:path";
import process from "node:process";
import * as fsp from "node:fs/promises";
import "zx/globals";
import { collectChangedPaths } from "../../lib/build-system-test-scope";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";
import { runNodeWithZx } from "../../lib/node-run";
import { repoNodeBinCandidates, resolveRepoNodeBin } from "../../lib/repo-node-bin";
import { resolveToolPath } from "../../lib/tool-paths";
import {
  filterExistingLintPreflightPaths,
  resolveLintPreflightFilterPaths,
} from "./lint-preflight-paths";
import {
  runVerifyFileSizePreflight,
  runVerifyLanguagesPreflight,
  runVerifyNixGapsPolicyPreflight,
  runVerifyStaleNamesPreflight,
  shouldRunBuildSystemPolicy,
} from "./lint-policy-preflights";
import {
  isEslintPath,
  isPrettierPath,
  normalizeRepoPath,
  shouldIgnoreLintPath,
} from "./lint-preflight-scope";

function verbose(): boolean {
  return isVbrVerbose();
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

async function resolveVerifyNodeBin(
  root: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  try {
    return await resolveRepoNodeBin(root, name, env);
  } catch {}
  const candidates = await repoNodeBinCandidates(root, name, env);
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
  if (includeBuildSystemPolicy) {
    await runVerifyLanguagesPreflight(root, zxInitPath, {
      zxNodeModulesOut: opts.zxNodeModulesOut,
    });
  }
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
  const changedPathsResult =
    lintFilters.length > 0 ? null : await collectChangedPaths(root, process.env);
  const changeAuthorityUnavailable = changedPathsResult?.ok === false;
  const fullRepoLintRequested = explicitLintPaths.includes(".") || changeAuthorityUnavailable;
  const rawChangedPaths = changedPathsResult?.ok ? changedPathsResult.paths : [];
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
    lintFilters.length > 0 || changeAuthorityUnavailable
      ? fullRepoLintRequested
        ? ["."]
        : explicitLintPaths.filter(isEslintPath)
      : changedLintPaths.filter(isEslintPath);
  const prettierTargets =
    lintFilters.length > 0 || changeAuthorityUnavailable
      ? fullRepoLintRequested
        ? ["."]
        : explicitLintPaths.filter(isPrettierPath)
      : changedLintPaths.filter(isPrettierPath);
  const scoped =
    ((lintFilters.length > 0 || changeAuthorityUnavailable) &&
      (eslintTargets.length > 0 || prettierTargets.length > 0)) ||
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
  const binEnv = envWithZxNodeModules(opts.zxNodeModulesOut);
  const eslintPath =
    scoped && eslintTargets.length > 0 ? await resolveVerifyNodeBin(root, "eslint", binEnv) : "";
  const prettierPath =
    scoped && prettierTargets.length > 0
      ? await resolveVerifyNodeBin(root, "prettier", binEnv)
      : "";

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
