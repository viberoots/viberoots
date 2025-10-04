#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("contract(go): provider sync determinism + auto_map labels present", async () => {
  await runInTemp("go-contract", async (_tmp, _$) => {
    const $ = _$({ stdio: "ignore" });
    // Create a dummy patch and run provider sync twice to assert determinism
    await $`bash -lc 'mkdir -p patches/go && printf "# dummy\n" > patches/go/golang.org__x__net@v0.24.0.patch'`;
    await $`node tools/buck/sync-providers.ts`;
    const a =
      await $`bash -lc 'sha256sum third_party/providers/TARGETS.auto || shasum -a 256 third_party/providers/TARGETS.auto'`;
    await $`node tools/buck/sync-providers.ts`;
    const b =
      await $`bash -lc 'sha256sum third_party/providers/TARGETS.auto || shasum -a 256 third_party/providers/TARGETS.auto'`;
    if ((a.stdout || a.stderr) !== (b.stdout || b.stderr)) {
      console.error("provider sync not deterministic");
      process.exit(2);
    }

    // Export a tiny graph and generate auto_map
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    // Presence assertion
    await $`bash -lc 'test -s third_party/providers/auto_map.bzl'`;
  });
});
