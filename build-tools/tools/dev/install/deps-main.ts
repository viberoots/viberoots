#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getFlagBool, getFlagStr, hasShortFlag } from "../../lib/cli";
import {
  warnNodeDepsInLocal,
  warnNodePatchRequirementsInLocal,
} from "../../lib/node-deps-enforcement";
import { findRepoRoot } from "../../lib/repo";
import { nodeModulesAttr } from "./common";
import { runGoModTidyForMissingSum } from "./go-tidy";
import { runGlue } from "./glue";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "./gomod2nix";
import { withExclusiveInstallLock } from "./lock";
import { syncModuleContractsForWebapps } from "./module-contracts";
import { runUvRefreshAll } from "./uv";
import { ensureToolchainPathsFiles } from "../toolchain-paths";
import { buildToolPath, zxInitPath } from "../dev-build/paths";
import { applyNixCacheHealthPolicy } from "../verify/nix-cache-health";
import { discoverImportersWithLock } from "./importers";
import { pruneNodeModulesHashesJson } from "../update-pnpm-hash/hashes-json";
import { ensureInstallSecretReadiness } from "./secret-readiness";
import { prewarmUnifiedPnpmStore } from "./unified-pnpm-prewarm";
import { importerInstallFreshness } from "./importer-freshness";
import { withInstallProgress } from "./progress";
import { writeGlueFingerprint } from "./glue-freshness";
import { checkBootstrapCompletion } from "../../lib/bootstrap-completion";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";
import { repairGeneratedWorkspaceLock } from "../../lib/workspace-lock-repair";

type Flags = {
  force: boolean;
  dryRun: boolean;
  verbose: boolean;
  skipGlue: boolean;
  glueOnly: boolean;
  skipGoTidy: boolean;
  withoutSecrets: boolean;
  yes: boolean;
  machineLabel: string;
  rotateBootstrapCredentials: boolean;
  rotateDeploymentCredentials: boolean;
  forceOverwriteLocalCredentials: boolean;
};

async function runGeneratedWorkspaceLockRepair(opts: {
  repoRoot: string;
  dryRun: boolean;
  verbose: boolean;
  phase: "initial" | "final";
}): Promise<void> {
  const lockRepair = await repairGeneratedWorkspaceLock({
    workspaceRoot: opts.repoRoot,
    dryRun: opts.dryRun,
    verbose: opts.verbose,
  });
  if (opts.dryRun && lockRepair.status === "would-repair") {
    console.log("[install-deps] dry-run: would refresh generated workspace viberoots lock input");
  } else if (opts.verbose && lockRepair.status === "skipped") {
    console.log(`[install-deps] workspace lock repair skipped: ${lockRepair.reason}`);
  } else if (opts.verbose && lockRepair.status === "fresh") {
    console.log(`[install-deps] workspace lock repair fresh (${opts.phase})`);
  }
}

function shouldRunFinalWorkspaceLockRepair(): boolean {
  return String(process.env.VBR_SKIP_FINAL_WORKSPACE_LOCK_REPAIR || "").trim() !== "1";
}

async function writeFinalPrebuildFingerprint(opts: {
  dryRun: boolean;
  skipGlue: boolean;
}): Promise<void> {
  if (opts.dryRun || opts.skipGlue) return;
  await writeGlueFingerprint(repoRoot);
}

function commandOutputTail(value: unknown): string {
  const output = String(value || "").trim();
  if (!output) return "";
  const max = 12_000;
  return output.length > max ? output.slice(output.length - max) : output;
}

function printFailedChildOutput(label: string, result: unknown): void {
  const proc = result as {
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
    cause?: { stdout?: unknown; stderr?: unknown };
  };
  const details = [proc.stderr, proc.stdout, proc.cause?.stderr, proc.cause?.stdout]
    .map(commandOutputTail)
    .filter(Boolean)
    .join("\n");
  process.stderr.write(`[install-deps] ${label} failed\n`);
  if (details) process.stderr.write(`${details}\n`);
}

// Resolve absolute workspace root path without requiring callers to run from repo root.
async function resolveWorkspaceRoot(): Promise<string> {
  const cwd = process.cwd();
  let gitRoot = "";
  try {
    const { stdout } = await $({ stdio: "pipe" })`git -C ${cwd} rev-parse --show-toplevel`.quiet();
    gitRoot = String(stdout || "").trim();
  } catch {}
  if (!gitRoot) gitRoot = await findRepoRoot(cwd);
  const wr = String(process.env.WORKSPACE_ROOT || "").trim();
  if (wr) {
    try {
      const abs = path.resolve(wr);
      if (abs === gitRoot) return abs;
    } catch {}
  }
  return gitRoot;
}
const envDryRun = process.env.INSTALL_DEPS_DRY_RUN === "1";
const envSkipGoTidy = process.env.INSTALL_DEPS_SKIP_GO_TIDY === "1";
const {
  force,
  dryRun,
  verbose,
  skipGlue,
  glueOnly,
  skipGoTidy,
  withoutSecrets,
  yes,
  machineLabel,
  rotateBootstrapCredentials,
  rotateDeploymentCredentials,
  forceOverwriteLocalCredentials,
} = {
  force: getFlagBool("force"),
  dryRun: getFlagBool("dry-run") || envDryRun,
  verbose: getFlagBool("verbose") || hasShortFlag("v") || isVbrVerbose(),
  skipGlue: getFlagBool("skip-glue"),
  glueOnly: getFlagBool("glue-only"),
  skipGoTidy: getFlagBool("skip-go-tidy") || envSkipGoTidy,
  withoutSecrets:
    getFlagBool("without-secrets") || process.env.INSTALL_DEPS_WITHOUT_SECRETS === "1",
  yes: getFlagBool("yes"),
  machineLabel: getFlagStr("machine-label", ""),
  rotateBootstrapCredentials: getFlagBool("rotate-bootstrap-credentials"),
  rotateDeploymentCredentials: getFlagBool("rotate-deployment-credentials"),
  forceOverwriteLocalCredentials: getFlagBool("force-overwrite-local-credentials"),
} satisfies Flags;
const ui = createCommandUi({ verbose });
if (verbose) console.log("Installing dependencies...");
else ui.heading("viberoots install");
// In glue-only mode, default to skipping go mod tidy unless explicitly overridden
const effSkipGoTidy =
  skipGoTidy || (glueOnly && String(process.env.INSTALL_DEPS_SKIP_GO_TIDY || "") !== "0");
const repoRoot = await resolveWorkspaceRoot();
await checkBootstrapCompletion({
  workspaceRoot: repoRoot,
  repair: !dryRun,
  verbose,
});
await applyNixCacheHealthPolicy(repoRoot);
// Make the selected workspace explicit so downstream helpers operate on the intended repo root.
try {
  if (String(process.env.WORKSPACE_ROOT || "").trim() !== repoRoot) {
    process.env.WORKSPACE_ROOT = repoRoot;
  }
  if (!String(process.env.BUCK_TEST_SRC || "").trim()) {
    process.env.BUCK_TEST_SRC = repoRoot;
  }
} catch {}
await ensureToolchainPathsFiles(repoRoot);
if (glueOnly) {
  if (verbose) console.log("[install-deps] glue-only mode");
  try {
    process.env.INSTALL_DEPS_GLUE_ONLY = "1";
    process.env.INSTALL_GLUE_SKIP_PNPM_HASH = "1";
  } catch {}
  // Minimal Go preparation so Nix graph builds are deterministic and fast
  if (!effSkipGoTidy) {
    await runGoModTidyForMissingSum(repoRoot, dryRun, verbose);
  } else if (verbose) {
    console.log("[skip] go mod tidy for missing go.sum");
  }
  // Fail fast for lock regeneration in glue-only to avoid long stalls
  process.env.INSTALL_DEPS_GOMOD_TIMEOUT = process.env.INSTALL_DEPS_GOMOD_TIMEOUT || "60";
  await runGomod2nixGenerate(dryRun, verbose);
  await runGomod2nixScanAll(dryRun, verbose);
  if (!skipGlue) {
    await runGlue(dryRun, verbose);
  } else if (verbose) {
    console.log("[skip] glue regeneration");
  }
  const glueOnlyImporters = await discoverImportersWithLock(repoRoot, { cwd: process.cwd() });
  await syncModuleContractsForWebapps(repoRoot, glueOnlyImporters, dryRun, verbose);
  if (!dryRun && shouldRunFinalWorkspaceLockRepair()) {
    await withExclusiveInstallLock(
      "workspace-lock-repair",
      async () => {
        await runGeneratedWorkspaceLockRepair({ repoRoot, dryRun, verbose, phase: "final" });
      },
      {
        verbose: verbose || String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
      },
    );
  } else if (!dryRun && verbose) {
    console.log("[install-deps] final workspace lock repair skipped");
  }
  await writeFinalPrebuildFingerprint({ dryRun, skipGlue });
  if (verbose) console.log("Glue refreshed.");
  else ui.ok("glue", "refreshed");
  process.exit(0);
}
const importers = await discoverImportersWithLock(repoRoot, { cwd: process.cwd() });
if (verbose) console.log("[install-deps] discovered importers:", importers.join(", "));
if (dryRun) {
  await runGeneratedWorkspaceLockRepair({ repoRoot, dryRun, verbose, phase: "initial" });
  for (const imp of importers) {
    const relLock = path.join(imp, "pnpm-lock.yaml");
    const attr = nodeModulesAttr(imp);
    console.log(`[node-modules] dry-run: skip hash/build/link for ${imp} (${relLock} -> ${attr})`);
  }
} else {
  if (verbose) {
    console.log("[install-deps] acquiring node-modules install lock...");
  }
  await withExclusiveInstallLock(
    "node-modules",
    async () => {
      const prevInstallLockSkip = process.env.INSTALL_LOCK_SKIP;
      process.env.INSTALL_LOCK_SKIP = "1";
      if (verbose) {
        console.log("[install-deps] lock acquired");
      }
      try {
        await runGeneratedWorkspaceLockRepair({ repoRoot, dryRun, verbose, phase: "initial" });
        const activeLockfiles = importers.map((imp) =>
          imp === "viberoots" ? "pnpm-lock.yaml" : path.join(imp, "pnpm-lock.yaml"),
        );
        const removedHashEntries = await pruneNodeModulesHashesJson(activeLockfiles);
        if (verbose && removedHashEntries.length > 0) {
          console.log(
            `[install-deps] pruned stale node-modules hash entries: ${removedHashEntries.join(", ")}`,
          );
        }
        const absUpdate = buildToolPath(repoRoot, "tools/dev/update-pnpm-hash.ts");
        const activeZxInit = zxInitPath(repoRoot);
        for (const imp of importers) {
          const commandCwd = repoRoot;
          const commandEnv = process.env;
          const relLock = path.join(imp, "pnpm-lock.yaml");
          const freshness = await importerInstallFreshness({
            repoRoot,
            importer: imp,
            force,
          });
          if (freshness.fresh) {
            if (verbose) {
              console.log(`[install-deps] importer ${imp}: node_modules already fresh; skipping`);
            } else {
              ui.ok("node_modules", `${imp} already fresh`);
            }
            continue;
          } else if (verbose) {
            console.log(
              `[install-deps] importer ${imp}: refreshing node_modules (${freshness.reason})`,
            );
          }
          if (verbose) {
            console.log(`[install-deps] importer ${imp}: preparing pnpm store (${relLock})`);
          } else {
            ui.step("node_modules", `${imp} refreshing`);
          }
          // Update the FOD hash for this importer lockfile
          const updateCmd = $({
            stdio: verbose ? "inherit" : "pipe",
            cwd: commandCwd,
            reject: false,
            env: {
              ...commandEnv,
              ZX_INIT: activeZxInit,
              // First-time/cold fixed-store builds can legitimately exceed 180s.
              // Keep a bounded timeout, but avoid prematurely killing healthy runs.
              NIX_PNPM_FETCH_TIMEOUT: String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600"),
            },
          })`zx-wrapper ${absUpdate} --lockfile ${relLock}`;
          const updateRes = verbose
            ? await updateCmd
            : await withInstallProgress(`node_modules ${imp} update-pnpm-hash`, updateCmd.quiet());
          if (updateRes.exitCode !== 0) {
            printFailedChildOutput(`update-pnpm-hash ${imp}`, updateRes);
            process.exit(updateRes.exitCode || 1);
          }
          // Realize and link importer node_modules via link-node (single strict path).
          if (verbose) {
            console.log(`[install-deps] importer ${imp}: realizing and linking node_modules`);
          }
          const linkCmd = $({
            cwd: commandCwd,
            stdio: verbose ? "inherit" : "pipe",
            reject: false,
            env: {
              ...commandEnv,
              ZX_INIT: activeZxInit,
              NIX_PNPM_FETCH_TIMEOUT: String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600"),
            },
          })`zx-wrapper ${buildToolPath(repoRoot, "tools/dev/install/link-node.ts")} --importer ${imp} ${force ? "--force" : ""}`;
          const linkRes = verbose
            ? await linkCmd
            : await withInstallProgress(`node_modules ${imp} link-node`, linkCmd.quiet());
          if (linkRes.exitCode !== 0) {
            printFailedChildOutput(`link-node ${imp}`, linkRes);
            process.exit(linkRes.exitCode || 1);
          }
        }
      } finally {
        if (prevInstallLockSkip === undefined) {
          delete process.env.INSTALL_LOCK_SKIP;
        } else {
          process.env.INSTALL_LOCK_SKIP = prevInstallLockSkip;
        }
      }
    },
    {
      verbose: verbose || String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
    },
  );
}
// Best-effort patches lint (non-fatal)
try {
  const patchesLintAbs = buildToolPath(repoRoot, "tools/dev/patches-lint.ts");
  await $({
    stdio: "inherit",
    env: { ...process.env, ZX_INIT: zxInitPath(repoRoot) },
  })`zx-wrapper ${patchesLintAbs}`.nothrow();
} catch {}
// Generate gomod2nix.toml at repo root (if present) and per project (projects/apps/*, projects/libs/*)
if (!skipGoTidy) {
  await runGoModTidyForMissingSum(repoRoot, dryRun, verbose);
} else if (verbose) {
  console.log("[skip] go mod tidy for missing go.sum");
}
// Invoke root gomod2nix regardless; the generator prints a clear skip or dry-run line
try {
  await runGomod2nixGenerate(dryRun, verbose);
} catch {}
await runGomod2nixScanAll(dryRun, verbose);
// Best-effort Python lock refresh (uv). No-ops if no uv.lock present.
await runUvRefreshAll(dryRun, verbose);
if (!skipGlue) {
  const prevSkipPnpmHash = process.env.INSTALL_GLUE_SKIP_PNPM_HASH;
  process.env.INSTALL_GLUE_SKIP_PNPM_HASH = "1";
  try {
    await runGlue(dryRun, verbose);
  } finally {
    if (prevSkipPnpmHash === undefined) {
      delete process.env.INSTALL_GLUE_SKIP_PNPM_HASH;
    } else {
      process.env.INSTALL_GLUE_SKIP_PNPM_HASH = prevSkipPnpmHash;
    }
  }
} else if (verbose) {
  console.log("[skip] glue regeneration");
}
await syncModuleContractsForWebapps(repoRoot, importers, dryRun, verbose);
if (!skipGlue) {
  await warnNodeDepsInLocal(repoRoot);
  await warnNodePatchRequirementsInLocal(repoRoot);
} else if (verbose) {
  console.log("[skip] node deps enforcement");
}
await prewarmUnifiedPnpmStore({ repoRoot, dryRun, verbose });
await ensureInstallSecretReadiness({
  repoRoot,
  dryRun,
  verbose,
  flags: {
    withoutSecrets,
    yes,
    machineLabel,
    rotateBootstrapCredentials,
    rotateDeploymentCredentials,
    forceOverwriteLocalCredentials,
  },
});
if (!dryRun && shouldRunFinalWorkspaceLockRepair()) {
  await withExclusiveInstallLock(
    "workspace-lock-repair",
    async () => {
      await runGeneratedWorkspaceLockRepair({ repoRoot, dryRun, verbose, phase: "final" });
    },
    {
      verbose: verbose || String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
    },
  );
} else if (!dryRun && verbose) {
  console.log("[install-deps] final workspace lock repair skipped");
}
await writeFinalPrebuildFingerprint({ dryRun, skipGlue });
if (verbose) console.log("Dependencies installed and node_modules linked.");
else ui.ok("install", "complete");
