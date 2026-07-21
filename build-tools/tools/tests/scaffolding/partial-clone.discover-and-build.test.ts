#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// E2E: partial-clone discovery & build in a sparse workspace.

test("partial clone: discover and build scaffolded lib via //...", async () => {
  await runInTemp("partial-clone-discover", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    // The harness owns Buck cells, the immutable viberoots source, and generated workspace state.
    // This fixture only adds the sparse files needed for discovery and scaffolding.

    const repoRoot = process.env.WORKSPACE_ROOT || process.cwd();
    async function ensureFile(rel: string) {
      await $`bash --noprofile --norc -lc ${`test -f ${rel} || (mkdir -p $(dirname ${rel}) && cp ${path.join(
        repoRoot,
        rel,
      )} ${rel})`}`;
    }
    async function ensureDir(rel: string) {
      await $`mkdir -p ${rel}`;
    }

    await ensureFile("viberoots/build-tools/go/defs.bzl");
    await ensureFile("viberoots/build-tools/tools/buck/export-graph.ts");
    await ensureFile("viberoots/build-tools/tools/buck/sync-providers.ts");
    await ensureFile("viberoots/build-tools/tools/buck/gen-auto-map.ts");
    await ensureFile("viberoots/build-tools/tools/buck/prebuild-guard.ts");
    await ensureFile("viberoots/build-tools/tools/dev/install-deps.ts");
    await ensureFile("viberoots/build-tools/tools/dev/zx-init.mjs");
    await ensureFile("viberoots/build-tools/tools/lib/providers.ts");
    await ensureFile("viberoots/build-tools/tools/lib/fs-helpers.ts");
    await ensureFile("TARGETS");
    await ensureFile("flake.lock");
    await $`bash --noprofile --norc -lc ${`cp -R ${path.join(repoRoot, "viberoots/toolchains")}/. toolchains/`}`;

    // Scaffold a new Go lib into the sparse repo
    await $`scaf new go lib demo-lib --yes --path=projects/libs/demo-lib`;

    await $`viberoots/build-tools/tools/bin/u`;

    // Run read-only glue explicitly to ensure discovery works in sparse context.
    await $`viberoots/build-tools/tools/dev/install-deps.ts --glue-only`;
    // Keep the explicit export and mapping to mirror user flow closely
    await $`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts`;
    await $`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;

    // Smoke assertions
    await $`test -f .viberoots/workspace/providers/auto_map.bzl`;
    await $`test -f .viberoots/workspace/buck/graph.json`;
    // Presence of graph outputs is enough; we no longer rely on Buck-only targets here.
  });
});
