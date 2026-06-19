#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsDevTool } from "./lib/viberoots-tools";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node webapp: nix_node_test target passes when no tests present", async () => {
  await runInTemp("node-webapp-nix-node-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`git init`;
    // Scaffold with test target enabled by default
    await $`scaf new ts webapp-static demo-web --yes --skip-lockfile-gen`;

    // Proceed; environment is expected to provide Buck prelude via runInTemp setup

    // Keep devDependencies; update-pnpm-hash will align lockfile/FOD

    // Remove any sample tests so the runner passes with no matches
    await fsp.rm(path.join(tmp, "projects", "apps", "demo-web", "test"), {
      recursive: true,
      force: true,
    });

    // Commit scaffold and lockfile so Nix flake sees importer under git+file sources
    await $`bash --noprofile --norc -c 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    // Primary path: `scaf new` produces a real importer lockfile under the importer directory.
    const importer = "projects/apps/demo-web";
    const lockfile = path.join(tmp, importer, "pnpm-lock.yaml");
    try {
      await fsp.access(lockfile);
    } catch {
      throw new Error("expected importer lockfile at apps/demo-web/pnpm-lock.yaml");
    }
    await $({
      stdio: "inherit",
      env: { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" },
    })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile ${path.join(importer, "pnpm-lock.yaml")}`;

    // Glue and provider mapping (export graph → providers → auto_map)
    await $`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    await $`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;

    // Target should exist and test should pass (no tests matched → success)
    await $({
      stdio: "inherit",
    })`buck2 targets --target-platforms prelude//platforms:default //projects/apps/demo-web:unit`;
    await $({
      stdio: "inherit",
    })`buck2 test --target-platforms prelude//platforms:default //projects/apps/demo-web:unit`;
  });
});
