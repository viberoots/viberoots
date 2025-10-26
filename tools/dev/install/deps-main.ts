#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { sanitizeName } from "./common.ts";
import { runGlue } from "./glue.ts";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "./gomod2nix.ts";
import { withExclusiveInstallLock } from "./lock.ts";

type Flags = {
  force: boolean;
  dryRun: boolean;
  verbose: boolean;
  skipGlue: boolean;
  glueOnly: boolean;
};

function parseFlags(argv: string[]): Flags {
  let force = false;
  let dryRun = process.env.INSTALL_DEPS_DRY_RUN === "1";
  let verbose = false;
  let skipGlue = false;
  let glueOnly = false;
  for (const a of argv) {
    if (a === "--force") force = true;
    if (a === "--dry-run") dryRun = true;
    if (a === "--verbose" || a === "-v") verbose = true;
    if (a === "--skip-glue") skipGlue = true;
    if (a === "--glue-only") glueOnly = true;
  }
  return { force, dryRun, verbose, skipGlue, glueOnly };
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
const { force, dryRun, verbose, skipGlue, glueOnly } = parseFlags(process.argv.slice(2));
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
  return out;
}

if (glueOnly) {
  if (verbose) console.log("[install-deps] glue-only mode");
  await runGlue(dryRun, verbose);
  console.log("Glue refreshed.");
  process.exit(0);
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
await runGomod2nixGenerate(dryRun, verbose);
await runGomod2nixScanAll(dryRun, verbose);
if (!skipGlue) {
  await runGlue(dryRun, verbose);
} else if (verbose) {
  console.log("[skip] glue regeneration");
}
console.log("Dependencies installed and node_modules linked.");
