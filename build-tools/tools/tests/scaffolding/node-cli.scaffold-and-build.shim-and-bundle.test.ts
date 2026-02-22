#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Ensure dev env tooling (yaml parser, zx deps) is exported in temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node cli: scaffold, build shim, run help", async () => {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  if (!prevRoots) {
    process.env.TEST_RSYNC_ROOTS = "build-tools toolchains third_party/providers prelude patches";
  }
  try {
    await runInTemp("node-cli-scaffold-shim", async (_tmp, $) => {
      await $`git init`;
      await $`scaf new ts cli demo --yes`;
      // Ensure Buck sees the new target
      await $`buck2 targets //projects/apps/demo:demo`;
      // Glue (target-scoped refresh so graph includes the newly scaffolded target)
      await $`BUCK_TARGET=//projects/apps/demo:demo build-tools/tools/dev/install-deps.ts --glue-only`;
      // Ensure Node providers are synced via orchestrator (primary path)
      await $`node build-tools/tools/buck/sync-providers.ts --lang=node`;
      await $`buck2 targets //projects/apps/demo:demo`;
      // Build shim target (default macro mode)
      await $`buck2 build --target-platforms prelude//platforms:default //projects/apps/demo:demo`;
      // Run help
      await $`node projects/apps/demo/bin/demo --help`;
    });
  } finally {
    if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
    else process.env.TEST_RSYNC_ROOTS = prevRoots;
  }
});
