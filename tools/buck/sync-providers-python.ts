#!/usr/bin/env zx-wrapper
// tools/buck/sync-providers-python.ts — delegator-only wrapper (back-compat)
import path from "node:path";
import process from "node:process";
import { runNodeWithZx } from "../lib/node-run.ts";

async function main() {
  const repoRoot = process.cwd();
  const zxInitPath = path.join(repoRoot, "tools/dev/zx-init.mjs");
  const orchestrator = path.join(repoRoot, "tools/buck/sync-providers.ts");
  const passthrough = process.argv.slice(2);
  await runNodeWithZx({
    zxInitPath,
    script: orchestrator,
    args: ["--lang", "python", "--no-glue", ...passthrough],
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
