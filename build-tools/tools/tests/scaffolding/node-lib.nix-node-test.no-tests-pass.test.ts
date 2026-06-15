#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsDevTool } from "./lib/viberoots-tools";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/;
const TEST_DIRS = new Set(["__tests__", "test", "tests"]);

async function removeImporterTests(absDir: string): Promise<void> {
  const entries = await fsp.readdir(absDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (TEST_DIRS.has(entry.name)) {
        await fs.remove(child);
        continue;
      }
      await removeImporterTests(child);
      continue;
    }
    if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      await fs.remove(child);
    }
  }
}

test("node lib: nix_node_test target passes when no tests present", async () => {
  await runInTemp("node-lib-nix-node-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`git init`;
    // Scaffold with test target enabled by default
    await $`scaf new ts lib demo --yes --skip-lockfile-gen`;

    // Fail fast if buck2 prelude is not available

    // Keep devDependencies; update-pnpm-hash will align lockfile/FOD

    // Remove any scaffolded sample tests so the runner truly exercises the no-tests path.
    await removeImporterTests(path.join(tmp, "projects", "libs", "demo"));

    // Commit scaffold and lockfile so Nix flake sees importer under git+file sources
    await $`bash --noprofile --norc -c 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    // Require `scaf new` primary path to produce the importer lockfile.
    await $`bash --noprofile --norc -c 'test -f projects/libs/demo/pnpm-lock.yaml'`;

    // Align the fixed-output hash mapping for this importer before running nix_node_test.
    await $({
      stdio: "inherit",
      env: { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" },
    })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile projects/libs/demo/pnpm-lock.yaml`;

    // Confirm Nix sees the importer lockfile path
    await $({
      stdio: "inherit",
    })`nix eval --impure --raw --expr 'builtins.toString (builtins.pathExists ./projects/libs/demo/pnpm-lock.yaml)'`;

    // Avoid pre-warming pnpm-store/node-modules here; nix_node_test will build what it needs.

    // Glue and provider mapping (export graph → providers → auto_map)
    await $`node build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;

    // Target should exist and test should pass (no tests matched → success)
    await $({
      stdio: "inherit",
    })`buck2 targets --target-platforms prelude//platforms:default //projects/libs/demo:unit`;
    await $({
      stdio: "inherit",
    })`buck2 test --target-platforms prelude//platforms:default //projects/libs/demo:unit`;
  });
});
