#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { getFlagBool, hasShortFlag } from "../../lib/cli.ts";
import { runNodeWithZx } from "../../lib/node-run.ts";
import {
  warnNodeDepsInLocal,
  warnNodePatchRequirementsInLocal,
} from "../../lib/node-deps-enforcement.ts";
import { findRepoRoot } from "../../lib/repo.ts";
import { nodeModulesAttr } from "./common.ts";
import { runGoModTidyForMissingSum } from "./go-tidy.ts";
import { runGlue } from "./glue.ts";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "./gomod2nix.ts";
import { withExclusiveInstallLock } from "./lock.ts";
import { syncModuleContractsForWebapps } from "./module-contracts.ts";
import { runUvRefreshAll } from "./uv.ts";
import { ensureToolchainPathsFiles } from "../toolchain-paths.ts";
import { discoverImportersWithLock, sharedUnifiedStorePath } from "./importers.ts";
import { pruneNodeModulesHashesJson } from "../update-pnpm-hash/hashes-json.ts";

type Flags = {
  force: boolean;
  dryRun: boolean;
  verbose: boolean;
  skipGlue: boolean;
  glueOnly: boolean;
  skipGoTidy: boolean;
};
// Resolve absolute workspace root path without requiring callers to run from repo root.
async function resolveWorkspaceRoot(): Promise<string> {
  const cwd = process.cwd();
  const wr = String(process.env.WORKSPACE_ROOT || "").trim();
  if (wr) {
    try {
      const abs = path.resolve(wr);
      if (cwd === abs || cwd.startsWith(abs + path.sep)) return abs;
    } catch {}
  }
  return await findRepoRoot(cwd);
}
console.log("Installing dependencies...");
const envDryRun = process.env.INSTALL_DEPS_DRY_RUN === "1";
const envSkipGoTidy = process.env.INSTALL_DEPS_SKIP_GO_TIDY === "1";
const { force, dryRun, verbose, skipGlue, glueOnly, skipGoTidy } = {
  force: getFlagBool("force"),
  dryRun: getFlagBool("dry-run") || envDryRun,
  verbose: getFlagBool("verbose") || hasShortFlag("v"),
  skipGlue: getFlagBool("skip-glue"),
  glueOnly: getFlagBool("glue-only"),
  skipGoTidy: getFlagBool("skip-go-tidy") || envSkipGoTidy,
} satisfies Flags;
// In glue-only mode, default to skipping go mod tidy unless explicitly overridden
const effSkipGoTidy =
  skipGoTidy || (glueOnly && String(process.env.INSTALL_DEPS_SKIP_GO_TIDY || "") !== "0");
const repoRoot = await resolveWorkspaceRoot();
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
  console.log("Glue refreshed.");
  process.exit(0);
}
const importers = await discoverImportersWithLock(repoRoot, { cwd: process.cwd() });
if (verbose) console.log("[install-deps] discovered importers:", importers.join(", "));
if (dryRun) {
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
        const activeLockfiles = importers.map((imp) => path.join(imp, "pnpm-lock.yaml"));
        const removedHashEntries = await pruneNodeModulesHashesJson(activeLockfiles);
        if (verbose && removedHashEntries.length > 0) {
          console.log(
            `[install-deps] pruned stale node-modules hash entries: ${removedHashEntries.join(", ")}`,
          );
        }
        const absUpdate = path.join(repoRoot, "build-tools/tools/dev/update-pnpm-hash.ts");
        for (const imp of importers) {
          const relLock = path.join(imp, "pnpm-lock.yaml");
          if (verbose) {
            console.log(`[install-deps] importer ${imp}: updating pnpm-store hash (${relLock})`);
          }
          // Update the FOD hash for this importer lockfile
          await $({
            stdio: "inherit",
            cwd: repoRoot,
            env: {
              ...process.env,
              // First-time/cold fixed-store builds can legitimately exceed 180s.
              // Keep a bounded timeout, but avoid prematurely killing healthy runs.
              NIX_PNPM_FETCH_TIMEOUT: String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600"),
            },
          })`zx-wrapper ${absUpdate} --lockfile ${relLock}`;
          // Realize and link importer node_modules via link-node (single strict path).
          if (verbose) {
            console.log(`[install-deps] importer ${imp}: realizing+linking node_modules`);
          }
          await $({
            cwd: path.join(repoRoot, imp),
            stdio: "inherit",
            env: {
              ...process.env,
              NIX_PNPM_FETCH_TIMEOUT: String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600"),
            },
          })`zx-wrapper ${path.join(repoRoot, "build-tools/tools/dev/install/link-node.ts")} ${force ? "--force" : ""}`;
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
  const patchesLintAbs = path.join(repoRoot, "build-tools/tools/dev/patches-lint.ts");
  await $({ stdio: "inherit" })`zx-wrapper ${patchesLintAbs}`.nothrow();
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
  await runGlue(dryRun, verbose);
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
// Prewarm unified PNPM store as part of install-deps so verify/build/test paths
// can consume it without blocking on first-use setup.
if (!dryRun) {
  try {
    const liveRepoRoot = String(process.env.REPO_ROOT || "").trim();
    const shouldPreferSharedPrewarm = !!liveRepoRoot && path.resolve(liveRepoRoot) !== repoRoot;
    let skippedForSharedStore = false;
    if (shouldPreferSharedPrewarm) {
      const shared = await sharedUnifiedStorePath(liveRepoRoot);
      if (shared) {
        if (verbose) {
          console.log(
            `[install-deps] skipping temp-workspace unified prewarm; using shared store marker from ${liveRepoRoot}`,
          );
        }
        skippedForSharedStore = true;
      }
    }
    if (!skippedForSharedStore) {
      const zxInitPath = path.join(repoRoot, "build-tools", "tools", "dev", "zx-init.mjs");
      if (verbose) {
        console.log("[install-deps] prewarming unified pnpm store");
      }
      await runNodeWithZx({
        cwd: repoRoot,
        script: path.join(repoRoot, "build-tools/tools/dev/require-unified-pnpm-store.ts"),
        args: [],
        zxInitPath,
        stdio: verbose ? "inherit" : "pipe",
        timeoutMs:
          Number.parseInt(process.env.INSTALL_UNIFIED_PNPM_TIMEOUT_MS || "180000", 10) || 180000,
      });
    }
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    const lockPath = path.join(repoRoot, "buck-out", ".unified-pnpm-store", "require.lock");
    console.warn(
      [
        `[install-deps] unified pnpm prewarm skipped: ${msg}`,
        "[install-deps] To recover:",
        `  1) remove stale lock if present: rm -f "${lockPath}"`,
        "  2) rerun: i",
        "  3) retry verify/build command",
      ].join("\n"),
    );
  }
} else if (verbose) {
  console.log("[install-deps] skipping unified pnpm prewarm in --dry-run mode");
}
console.log("Dependencies installed and node_modules linked.");
