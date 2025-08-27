#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

console.log("Installing dependencies...");
function parseFlags(argv: string[]): { force: boolean } {
  let force = false;
  for (const a of argv) {
    if (a === "--force") force = true;
  }
  return { force };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function relinkNodeModules(force: boolean) {
  const { stdout } = await $({
    stdio: "pipe",
  })`nix build .#node-modules --no-link --accept-flake-config --print-out-paths`;
  const outPath = String(stdout).trim();
  if (!outPath) return;
  const linkTarget = path.join(outPath, "node_modules");
  const nm = path.join(process.cwd(), "node_modules");
  const existsNm = await exists(nm);
  if (existsNm && !(await fsp.lstat(nm)).isSymbolicLink()) {
    if (!force) {
      console.error("node_modules exists and is not a symlink. Use --force to replace.");
      process.exit(2);
    }
    await fsp.rm(nm, { recursive: true, force: true });
  }
  await fsp.symlink(linkTarget, nm).catch(async () => {
    await fsp.rm(nm, { recursive: true, force: true }).catch(() => {});
    await fsp.symlink(linkTarget, nm);
  });
}

async function main() {
  const { force } = parseFlags(process.argv.slice(2));
  await fsp.rm("node_modules", { force: true });
  await $({ stdio: "inherit" })`pnpm install --lockfile-only`;
  await $({ stdio: "inherit" })`tools/dev/update-pnpm-hash.ts`;
  await $({ stdio: "inherit" })`nix build .#node-modules --accept-flake-config`;
  await relinkNodeModules(force);
  console.log("Dependencies installed and node_modules linked.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
