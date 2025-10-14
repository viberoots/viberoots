#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runGlue, zxNodeBase } from "./glue.ts";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "./gomod2nix.ts";
import { relinkNodeModules } from "./link-node.ts";

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

async function have(cmd: string): Promise<boolean> {
  try {
    await $({ stdio: "pipe" })`bash --noprofile --norc -c 'command -v ${cmd} >/dev/null 2>&1'`;
    return true;
  } catch {
    return false;
  }
}

export async function main() {
  // Normalize CWD to repo root so this script works from any directory
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const root = path.resolve(here, "..", "..", "..");
    process.chdir(root);
  } catch {}
  console.log("Installing dependencies...");
  const { force, dryRun, verbose, skipGlue, glueOnly } = parseFlags(process.argv.slice(2));
  if (glueOnly) {
    if (verbose) console.log("[install-deps] glue-only mode");
    await runGlue(dryRun, verbose);
    console.log("Glue refreshed.");
    return;
  }
  await fsp.rm("node_modules", { force: true });
  // Ensure pnpm uses a writable store for the lockfile-only operation. On some systems
  // a global pnpm config may point to /nix/store, which is read-only (EACCES after nix gc).
  const localPnpmStore = path.join(process.cwd(), ".pnpm-store");
  await fsp.mkdir(localPnpmStore, { recursive: true });
  const useNixPnpm = await have("nix");
  const envWithStore = { ...process.env, npm_config_store_dir: localPnpmStore } as Record<
    string,
    string
  >;
  if (useNixPnpm) {
    await $({ stdio: "inherit", env: envWithStore })`pnpm install --lockfile-only`;
  } else {
    await $({ stdio: "inherit", env: envWithStore })`pnpm install --lockfile-only`;
  }
  await $({ stdio: "inherit" })`tools/dev/update-pnpm-hash.ts`;
  await $({ stdio: "inherit" })`nix build .#node-modules --no-link --accept-flake-config`;
  await relinkNodeModules(force);
  try {
    const nodeBase = zxNodeBase();
    await $({
      stdio: "inherit",
    })`bash --noprofile --norc -c ${`node ${nodeBase} tools/dev/patches-lint.ts`}`;
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
}

export { have };
