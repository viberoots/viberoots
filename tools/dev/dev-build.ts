#!/usr/bin/env zx-wrapper
import path from "node:path";
import "zx/globals";

function shouldInstallDeps(): boolean {
  // Placeholder for future heuristics (node_modules symlink, gomod2nix freshness, etc.)
  return true;
}

function zxNodeBase(): string {
  const zxInit = path.resolve("tools/dev/zx-init.mjs");
  return [
    "--experimental-top-level-await",
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "--import",
    zxInit,
  ].join(" ");
}

async function main() {
  const isCI = process.env.CI === "true";
  const argsIn = process.argv.slice(2);
  const args = argsIn.length === 0 ? ["build", "//..."] : argsIn;

  if (!isCI && shouldInstallDeps()) {
    const nodeBase = zxNodeBase();
    const nodeBin = process.execPath || "node";
    await $({
      stdio: "inherit",
    })`bash -lc ${`${nodeBin} ${nodeBase} tools/dev/install-deps.ts --glue-only`}`;
  }

  const proc = await $({ stdio: "inherit" })`buck2 ${args}`.catch((e) => e);
  const code = typeof proc?.exitCode === "number" ? proc.exitCode : 1;
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
