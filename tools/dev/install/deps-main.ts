#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { sanitizeName } from "./common.ts";
import { runGlue } from "./glue.ts";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "./gomod2nix.ts";
import { withExclusiveInstallLock } from "./lock.ts";
import { runUvRefreshAll } from "./uv.ts";

type Flags = {
  force: boolean;
  dryRun: boolean;
  verbose: boolean;
  skipGlue: boolean;
  glueOnly: boolean;
  skipGoTidy: boolean;
};

function parseFlags(argv: string[]): Flags {
  let force = false;
  let dryRun = process.env.INSTALL_DEPS_DRY_RUN === "1";
  let verbose = false;
  let skipGlue = false;
  let glueOnly = false;
  let skipGoTidy = process.env.INSTALL_DEPS_SKIP_GO_TIDY === "1";
  for (const a of argv) {
    if (a === "--force") force = true;
    if (a === "--dry-run") dryRun = true;
    if (a === "--verbose" || a === "-v") verbose = true;
    if (a === "--skip-glue") skipGlue = true;
    if (a === "--glue-only") glueOnly = true;
    if (a === "--skip-go-tidy") skipGoTidy = true;
  }
  return { force, dryRun, verbose, skipGlue, glueOnly, skipGoTidy };
}

// Resolve absolute workspace root path using ZX_INIT, without changing process CWD.
function resolveWorkspaceRoot(): string | null {
  // Prefer explicit temp-repo root when provided by test harness
  const wr = process.env.WORKSPACE_ROOT || "";
  if (wr) {
    try {
      return path.resolve(wr);
    } catch {}
  }
  // Next prefer current working directory (tests often chdir into the temp repo)
  try {
    const cwd = process.cwd();
    if (cwd) return path.resolve(cwd);
  } catch {}
  // Otherwise infer from ZX_INIT path
  const zx = process.env.ZX_INIT || "";
  if (zx) {
    try {
      const p = path.resolve(zx);
      return path.resolve(path.dirname(p), "..", "..");
    } catch {}
  }
  return null;
}
console.log("Installing dependencies...");
const { force, dryRun, verbose, skipGlue, glueOnly, skipGoTidy } = parseFlags(
  process.argv.slice(2),
);
// In glue-only mode, default to skipping go mod tidy unless explicitly overridden
const effSkipGoTidy =
  skipGoTidy || (glueOnly && String(process.env.INSTALL_DEPS_SKIP_GO_TIDY || "") !== "0");
const repoRoot = resolveWorkspaceRoot() || process.cwd();
// Discover importers (apps/*, libs/*) that contain a pnpm-lock.yaml.
async function discoverImportersWithLock(root: string): Promise<string[]> {
  const candidates = ["apps", "libs"];
  const out: string[] = [];
  for (const base of candidates) {
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
  // Skip the shared test importer by default to avoid unnecessary FOD updates and noisy output.
  // Allow opting in explicitly via INSTALL_INCLUDE_SHARED_TEST_IMPORTER=1.
  const includeShared =
    String(process.env.INSTALL_INCLUDE_SHARED_TEST_IMPORTER || "").trim() === "1";
  const filtered = includeShared ? out : out.filter((imp) => imp !== "libs/test-deps");
  return filtered;
}

if (glueOnly) {
  if (verbose) console.log("[install-deps] glue-only mode");
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
  await runGlue(dryRun, verbose);
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
      const attr = sanitizeName(imp);
      await $({
        stdio: "inherit",
      })`nix build ${repoRoot}#node-modules.${attr} --no-link --accept-flake-config --print-build-logs`;
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
console.log("Dependencies installed and node_modules linked.");
