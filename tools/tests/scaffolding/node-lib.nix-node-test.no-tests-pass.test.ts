#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import fs from "fs-extra";
import { runInTemp } from "../lib/test-helpers";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node lib: nix_node_test target passes when no tests present", async () => {
  await runInTemp("node-lib-nix-node-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`git init`;
    // Scaffold with test target enabled by default
    await $`scaf new node lib demo --yes`;

    // Fail fast if buck2 prelude is not available

    // Keep devDependencies; update-pnpm-hash will align lockfile/FOD

    // Remove any sample tests so the runner passes with no matches
    await fs.remove(path.join(tmp, "libs", "demo", "test"));

    // Commit scaffold and lockfile so Nix flake sees importer under git+file sources
    await $`bash -lc 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    // Update fixed-output hash for this importer
    await $({
      stdio: "inherit",
    })`NIX_PNPM_ALLOW_GENERATE=1 node tools/dev/update-pnpm-hash.ts --lockfile libs/demo/pnpm-lock.yaml`;

    // If lockfile wasn't written under the importer (workspace root wrote it), copy it and re-hash
    await $`bash -lc 'test -f pnpm-lock.yaml && [ ! -f libs/demo/pnpm-lock.yaml ] && cp pnpm-lock.yaml libs/demo/pnpm-lock.yaml || true'`;
    await $({
      stdio: "inherit",
    })`node tools/dev/update-pnpm-hash.ts --lockfile libs/demo/pnpm-lock.yaml`;

    // Assert lockfile exists and dump importer directory for debugging
    await $`bash -lc 'set -e; echo "==== ls -la libs/demo ====\n"; ls -la libs/demo; test -f libs/demo/pnpm-lock.yaml'`;
    // Confirm Nix sees the importer lockfile path
    await $({
      stdio: "inherit",
    })`nix eval --impure --raw --expr 'builtins.toString (builtins.pathExists ./libs/demo/pnpm-lock.yaml)'`;

    // Warm pnpm-store/node-modules for this importer and restart buckd to pick updated digest
    await $({ stdio: "inherit" })`nix build --impure --accept-flake-config .#pnpm-store.libs-demo`;
    await $({
      stdio: "inherit",
    })`nix build --impure --accept-flake-config .#node-modules.libs-demo`;
    // Reconcile any FOD digest drift detected during warm-up
    await $({
      stdio: "inherit",
    })`node tools/dev/update-pnpm-hash.ts --lockfile libs/demo/pnpm-lock.yaml`;
    await $({ stdio: "inherit" })`buck2 kill`.nothrow();

    // Glue and provider mapping (export graph → providers → auto_map)
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/sync-providers.ts --lang=node`;

    // Target should exist and test should pass (no tests matched → success)
    await $({
      stdio: "inherit",
    })`buck2 targets --target-platforms prelude//platforms:default //libs/demo:unit`;
    await $({
      stdio: "inherit",
    })`buck2 test --target-platforms prelude//platforms:default //libs/demo:unit`;
  });
});
