#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { runGlue, zxNodeBase } from "./glue.ts";
import { runGomod2nixGenerate } from "./gomod2nix.ts";
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
  console.log("Installing dependencies...");
  const { force, dryRun, verbose, skipGlue, glueOnly } = parseFlags(process.argv.slice(2));
  if (glueOnly) {
    if (verbose) console.log("[install-deps] glue-only mode");
    await runGlue(dryRun, verbose);
    console.log("Glue refreshed.");
    return;
  }
  await fsp.rm("node_modules", { force: true });
  await $({ stdio: "inherit" })`pnpm install --lockfile-only`;
  await $({ stdio: "inherit" })`tools/dev/update-pnpm-hash.ts`;
  await $({ stdio: "inherit" })`nix build .#node-modules --no-link --accept-flake-config`;
  await relinkNodeModules(force);
  try {
    const nodeBase = zxNodeBase();
    await $({
      stdio: "inherit",
    })`bash --noprofile --norc -c ${`node ${nodeBase} tools/dev/patches-lint.ts`}`;
  } catch {}
  await runGomod2nixGenerate(dryRun, verbose);
  if (!skipGlue) {
    await runGlue(dryRun, verbose);
  } else if (verbose) {
    console.log("[skip] glue regeneration");
  }
  console.log("Dependencies installed and node_modules linked.");
}

export { have };
