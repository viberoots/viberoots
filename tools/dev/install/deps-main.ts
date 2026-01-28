#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { nodeModulesAttr } from "./common.ts";
import { runGlue } from "./glue.ts";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "./gomod2nix.ts";
import { withExclusiveInstallLock } from "./lock.ts";
import { runUvRefreshAll } from "./uv.ts";
import { getFlagBool, hasShortFlag } from "../../lib/cli.ts";
import { getImporterRootsContract } from "../../lib/importer-roots.ts";
import { findRepoRoot } from "../../lib/repo.ts";
import { warnNodeDepsInLocal } from "../../lib/node-deps-enforcement.ts";
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
// Make the selected workspace explicit so downstream helpers (ensureGraph, provider writers, etc.)
// operate on the intended repo root even when invoked from a subdirectory.
try {
  if (String(process.env.WORKSPACE_ROOT || "").trim() !== repoRoot) {
    process.env.WORKSPACE_ROOT = repoRoot;
  }
  if (!String(process.env.BUCK_TEST_SRC || "").trim()) {
    process.env.BUCK_TEST_SRC = repoRoot;
  }
} catch {}
// Discover importers (apps/*, libs/*) that contain a pnpm-lock.yaml.
async function discoverImportersWithLock(root: string): Promise<string[]> {
  const { allowDotImporter, workspaceRoots } = getImporterRootsContract();
  const out: string[] = [];
  // Root importer (.) is supported when enabled and pnpm-lock.yaml exists at repo root.
  if (allowDotImporter) {
    try {
      await fsp.access(path.join(root, "pnpm-lock.yaml"));
      out.push(".");
    } catch {}
  }
  for (const base of workspaceRoots) {
    const baseAbs = path.join(root, base);
    try {
      const entries = await fsp.readdir(baseAbs).catch(() => [] as string[]);
      for (const d of entries) {
        const p = path.join(baseAbs, d);
        try {
          const st = await fsp.stat(p);
          if (st.isDirectory()) {
            const lock = path.join(p, "pnpm-lock.yaml");
            try {
              await fsp.access(lock);
              // Record as relative path from root
              out.push(path.relative(root, p) || ".");
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }
  return out;
}

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
  console.log("Glue refreshed.");
  process.exit(0);
}

async function runGoModTidyForMissingSum(root: string, dryRun: boolean, verbose: boolean) {
  const bases = [".", "apps", "libs"];
  for (const base of bases) {
    const baseAbs = path.join(root, base);
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(baseAbs).catch(() => [] as string[]);
    } catch {}
    // Also consider the root itself when base is "."
    if (base === ".") {
      const hasRootMod = await fsp
        .access(path.join(baseAbs, "go.mod"))
        .then(() => true)
        .catch(() => false);
      const hasRootSum = await fsp
        .access(path.join(baseAbs, "go.sum"))
        .then(() => true)
        .catch(() => false);
      if (hasRootMod && !hasRootSum) {
        if (dryRun) {
          console.log(`[go] dry-run: (missing go.sum) in .: go mod tidy (isolated)`);
        } else {
          if (verbose) console.log(`[go] go mod tidy (isolated) for .`);
          // Run tidy in an isolated temp dir to avoid test fixtures under tools/ influencing import paths
          const tmpTidy = await fsp.mkdtemp(path.join(os.tmpdir(), "go-tidy-"));
          try {
            await fsp.copyFile(path.join(baseAbs, "go.mod"), path.join(tmpTidy, "go.mod"));
            await $({ cwd: tmpTidy, stdio: "inherit" })`go mod tidy`;
            // Copy back produced go.sum
            const tmpSum = path.join(tmpTidy, "go.sum");
            const exists = await fsp
              .access(tmpSum)
              .then(() => true)
              .catch(() => false);
            if (exists) {
              await fsp.copyFile(tmpSum, path.join(baseAbs, "go.sum"));
            } else {
              // Create an empty go.sum to satisfy downstream tools expecting the file
              await fsp.writeFile(path.join(baseAbs, "go.sum"), "", "utf8");
            }
          } finally {
            await fsp.rm(tmpTidy, { recursive: true, force: true }).catch(() => {});
          }
        }
      }
    }
    for (const d of entries) {
      const dir = path.join(baseAbs, d);
      try {
        const st = await fsp.stat(dir);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }
      const hasMod = await fsp
        .access(path.join(dir, "go.mod"))
        .then(() => true)
        .catch(() => false);
      const hasSum = await fsp
        .access(path.join(dir, "go.sum"))
        .then(() => true)
        .catch(() => false);
      if (hasMod && !hasSum) {
        const rel = path.relative(root, dir) || ".";
        if (dryRun) {
          console.log(`[go] dry-run: (missing go.sum) in ${rel}: go mod tidy`);
        } else {
          if (verbose) console.log(`[go] go mod tidy in ${rel}`);
          await $({ cwd: dir, stdio: "inherit" })`go mod tidy`;
        }
      }
    }
  }
}
await withExclusiveInstallLock(
  "node-modules",
  async () => {
    const importers = await discoverImportersWithLock(repoRoot);
    const absUpdate = path.join(repoRoot, "tools/dev/update-pnpm-hash.ts");
    if (verbose) console.log("[install-deps] discovered importers:", importers.join(", "));
    for (const imp of importers) {
      const relLock = path.join(imp, "pnpm-lock.yaml");
      // Update the FOD hash for this importer lockfile
      await $({
        stdio: "inherit",
        cwd: repoRoot,
        env: { ...process.env, INSTALL_LOCK_SKIP: "1" },
      })`zx-wrapper ${absUpdate} --lockfile ${relLock}`;
      // Build the importer-scoped node_modules via Nix (pure sandbox)
      const attr = nodeModulesAttr(imp);
      await $({
        stdio: "inherit",
      })`nix build ${repoRoot}#${attr} --no-link --accept-flake-config --print-build-logs`;
      // Link apps/<name>/node_modules -> Nix output's node_modules (remove stale link first)
      await $({
        cwd: path.join(repoRoot, imp),
        stdio: "inherit",
      })`zx-wrapper ${path.join(repoRoot, "tools/dev/install/link-node.ts")} ${force ? "--force" : ""}`.nothrow();
    }
  },
  { verbose: String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1" },
);
// Best-effort patches lint (non-fatal)
try {
  const patchesLintAbs = path.join(repoRoot, "tools/dev/patches-lint.ts");
  await $({ stdio: "inherit" })`zx-wrapper ${patchesLintAbs}`.nothrow();
} catch {}
// Generate gomod2nix.toml at repo root (if present) and per-app/lib (apps/*, libs/*)
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
if (!skipGlue) {
  await warnNodeDepsInLocal(repoRoot);
} else if (verbose) {
  console.log("[skip] node deps enforcement");
}
console.log("Dependencies installed and node_modules linked.");
