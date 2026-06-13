#!/usr/bin/env zx-wrapper
import { resolveWorkspaceRootSync } from "../lib/repo";
import { run } from "./exporter/main";

async function main() {
  // Prefer WORKSPACE_ROOT (set by zx test harness) over BUCK_TEST_SRC so simulated graphs
  // and module detection run against the temp repo, not the host workspace.
  try {
    process.chdir(resolveWorkspaceRootSync());
  } catch {}
  await run();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
