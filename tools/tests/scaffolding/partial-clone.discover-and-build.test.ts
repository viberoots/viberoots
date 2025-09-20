#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import path from "node:path";

// Phase 7 — E2E partial-clone discovery & build
// Proves decentralized registration: a sparse repo with minimal shared files + one scaffolded package builds after glue generation.

test("partial clone: discover and build scaffolded lib via //...", async () => {
  await runInTemp("partial-clone-discover-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });

    // The test harness already rsyncs a minimal repo (excludes libs), writes .buckconfig and prelude.
    // We only need to ensure shared glue scripts exist (copied from repo root if missing) and scaffold a package.

    const repoRoot = process.env.WORKSPACE_ROOT || process.cwd();
    async function ensureFile(rel: string) {
      await $`bash --noprofile --norc -lc ${
        `test -f ${rel} || (mkdir -p $(dirname ${rel}) && cp ${path.join(
          repoRoot,
          rel,
        )} ${rel})`
      }`;
    }
    async function ensureDir(rel: string) {
      await $`mkdir -p ${rel}`;
    }

    await ensureFile("go/defs.bzl");
    await ensureFile("tools/buck/export-graph.ts");
    await ensureFile("tools/buck/sync-providers.ts");
    await ensureFile("tools/buck/gen-auto-map.ts");
    await ensureFile("tools/buck/prebuild-guard.ts");
    await ensureFile("tools/dev/install-deps.ts");
    await ensureFile("tools/dev/zx-init.mjs");
    await ensureFile("tools/lib/providers.ts");
    await ensureFile("tools/lib/fs-helpers.ts");
    await ensureDir("third_party/providers");
    await ensureFile("TARGETS");

    // Scaffold a new Go lib into the sparse repo
    await $`scaf new go lib demo-lib --yes --path=libs/demo-lib`;

    // Initialize go module & run gomod2nix via our install script
    await $`bash --noprofile --norc -lc 'cd libs/demo-lib && test -f go.mod || go mod init example.com/demo-lib && go mod tidy'`;
    await $`tools/dev/install-deps.ts --glue-only`;

    // Run glue explicitly to ensure discovery works in sparse context
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/sync-providers.ts`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;

    // Build all; Buck should discover the new package via //...
    await $`buck2 build --target-platforms prelude//platforms:default //...`;

    // Smoke assertions
    await $`test -f third_party/providers/auto_map.bzl`;
    await $`test -f tools/buck/graph.json`;
    const q = await $`buck2 targets --target-platforms prelude//platforms:default //libs/demo-lib/...`;
    if (!String(q.stdout || "").trim()) {
      throw new Error("expected at least one target under //libs/demo-lib/..., got none");
    }
  });
});
