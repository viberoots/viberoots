#!/usr/bin/env zx-wrapper
import { run } from "./exporter/main.ts";

async function main() {
  // If a test provided a temporary repo root, run exporter from there so buck2 cquery
  // discovers targets in the temp repo rather than the main workspace.
  try {
    const src = (process.env.BUCK_TEST_SRC || "").trim();
    if (src) process.chdir(src);
  } catch {}
  await run();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
