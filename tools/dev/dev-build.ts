#!/usr/bin/env zx-wrapper
import "zx/globals";

function shouldInstallDeps(): boolean {
  // Placeholder for future heuristics (node_modules symlink, gomod2nix freshness, etc.)
  return true;
}

async function main() {
  const isCI = process.env.CI === "true";
  const args = process.argv.slice(2);

  if (!isCI && shouldInstallDeps()) {
    await $({ stdio: "inherit" })`node tools/dev/install-deps.ts --glue-only`;
  }

  const proc = await $({ stdio: "inherit" })`buck2 ${args}`.catch((e) => e);
  const code = typeof proc?.exitCode === "number" ? proc.exitCode : 1;
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
