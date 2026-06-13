#!/usr/bin/env zx-wrapper
import { resolveWorkspaceRootSync } from "../lib/repo";
import { ensureWorkspaceBuckStatePackage } from "../lib/workspace-buck-state";
import { ensureWorkspaceProvidersPackage } from "../lib/workspace-providers-package";
import { run } from "./exporter/main";

async function main() {
  // Prefer WORKSPACE_ROOT (set by zx test harness) over BUCK_TEST_SRC so simulated graphs
  // and module detection run against the temp repo, not the host workspace.
  try {
    process.chdir(resolveWorkspaceRootSync());
  } catch {}
  await ensureWorkspaceBuckStatePackage(process.cwd());
  await ensureWorkspaceProvidersPackage(process.cwd());
  await run();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
