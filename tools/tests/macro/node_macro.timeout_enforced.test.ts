#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Verify that nix_node_test honors the external timeout and fails when the test run exceeds it.
test("nix_node_test: external timeout is enforced", { timeout: 420_000 }, async () => {
  // Ensure dev env so 'scaf' and 'buck2' resolve inside the temp repo
  process.env.TEST_NEED_DEV_ENV = "1";
  await runInTemp("node-macro-timeout", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    const env = {
      ...process.env,
      NIX_PNPM_ALLOW_GENERATE: "1",
      INSTALL_LOCK_SKIP: "1",
      NIX_PNPM_FETCH_TIMEOUT: "300",
      // Ensure scaffolding and downstream tools treat the temp repo as the workspace root
      WORKSPACE_ROOT: tmp,
      HOME: tmp,
    } as Record<string, string>;

    await $`git init`;
    await $({ env })`scaf new node lib demo --yes`;
    await $({
      env,
    })`bash --noprofile --norc -c 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    const importer = "libs/demo";
    const lockfile = path.join(importer, "pnpm-lock.yaml");

    // Create a deliberately slow test (~5 seconds)
    const slowTest = [
      'import { test, expect } from "vitest";',
      'test("slow", async () => {',
      "  await new Promise((r) => setTimeout(r, 5000));",
      "  expect(true).toBe(true);",
      "});",
      "",
    ].join("\n");
    await fsp.mkdir(path.join(tmp, importer, "test"), { recursive: true });
    await fsp.writeFile(path.join(tmp, importer, "test", "slow.test.ts"), slowTest, "utf8");

    // Replace TARGETS with a dedicated nix_node_test target that only runs the slow test and has a tiny timeout.
    const targets = [
      'load("//node:defs.bzl", "nix_node_test")',
      "",
      "nix_node_test(",
      '    name = "timeout_short",',
      '    lockfile_label = "lockfile:libs/demo/pnpm-lock.yaml#libs/demo",',
      "    patterns = [",
      '        "test/slow.test.ts",',
      "    ],",
      "    env = {",
      '        "NIX_PNPM_ALLOW_GENERATE": "1",',
      '        "NIX_PNPM_FETCH_TIMEOUT": "300",',
      "    },",
      "    timeout_sec = 1,",
      ")",
      "",
    ].join("\n");
    await fsp.writeFile(path.join(tmp, importer, "TARGETS"), targets, "utf8");

    // Expect timeout failure at Buck level.
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env,
    })`buck2 test //libs/demo:timeout_short`.nothrow();
    if (res.exitCode === 0) {
      throw new Error("expected buck2 test to fail due to external timeout");
    }
  });
});
