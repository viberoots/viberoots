#!/usr/bin/env zx-wrapper
import { run } from "./exporter/main.ts";

async function main() {
  // Prefer WORKSPACE_ROOT (set by zx test harness) over BUCK_TEST_SRC so simulated graphs
  // and module detection run against the temp repo, not the host workspace.
  try {
    const ws = (process.env.WORKSPACE_ROOT || "").trim();
    const src = (process.env.BUCK_TEST_SRC || "").trim();
    if (ws) process.chdir(ws);
    else if (src) process.chdir(src);
  } catch {}
  await run();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
