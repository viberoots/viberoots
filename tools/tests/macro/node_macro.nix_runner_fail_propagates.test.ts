#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Verify that the nix_node_test external runner propagates test failures to Buck (non-zero).
test("nix_node_test: buck2 test fails when importer tests fail", { timeout: 420_000 }, async () => {
  // Ensure dev env so 'scaf' and 'buck2' resolve inside the temp repo
  process.env.TEST_NEED_DEV_ENV = "1";
  await runInTemp("node-macro-fail-propagates", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "inherit" });
    const env = {
      ...process.env,
      NIX_PNPM_ALLOW_GENERATE: "1",
      NIX_PNPM_FETCH_TIMEOUT: "300",
      // Ensure scaffolding and downstream tools treat the temp repo as the workspace root
      WORKSPACE_ROOT: tmp,
      HOME: tmp,
    } as Record<string, string>;

    await $`git init`;
    await $({ env })`scaf new node lib demo --yes --skip-lockfile-gen`;
    await $({
      env,
    })`bash --noprofile --norc -c 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    const importer = "libs/demo";
    // Overwrite TARGETS to enforce allow-generate semantics in the runner
    const targets = [
      'load("//node:defs.bzl", "nix_node_lib", "nix_node_test")',
      "",
      "nix_node_lib(",
      '    name = "demo",',
      "    srcs = [],",
      '    out = "build.stamp",',
      '    cmd = "echo ok > $OUT",',
      '    lockfile_label = "lockfile:libs/demo/pnpm-lock.yaml#libs/demo",',
      ")",
      "",
      "nix_node_test(",
      '    name = "unit",',
      '    srcs = glob(["src/**/*.ts", "src/**/*.js", "test/**/*.ts", "test/**/*.js", "__tests__/**/*.ts", "__tests__/**/*.js"]),',
      '    lockfile_label = "lockfile:libs/demo/pnpm-lock.yaml#libs/demo",',
      "    env = {",
      '        "NIX_PNPM_ALLOW_GENERATE": "1",',
      '        "NIX_PNPM_FETCH_TIMEOUT": "300",',
      "    },",
      ")",
      "",
    ].join("\n");
    await fsp.mkdir(path.join(tmp, importer), { recursive: true });
    await fsp.writeFile(path.join(tmp, importer, "TARGETS"), targets, "utf8");

    // Ensure the importer lockfile exists at libs/demo/pnpm-lock.yaml (some scaffolding flows
    // write at repo root). Then align the fixed-output hash mapping for the importer so nix_node_test
    // fails for the intended reason (test failures), not due to pnpm-store hash mismatch.
    await $`bash --noprofile --norc -c 'test -f pnpm-lock.yaml && [ ! -f libs/demo/pnpm-lock.yaml ] && cp pnpm-lock.yaml libs/demo/pnpm-lock.yaml || true'`;
    await $({
      stdio: "inherit",
      env: { ...env, NIX_PNPM_ALLOW_GENERATE: "1" },
    })`zx-wrapper tools/dev/update-pnpm-hash.ts --force --lockfile libs/demo/pnpm-lock.yaml`;

    // Add an explicitly failing test file
    const failingTest = [
      'import { test, expect } from "vitest";',
      'test("failing", () => {',
      "  expect(true).toBe(false);",
      "});",
      "",
    ].join("\n");
    await fsp.writeFile(path.join(tmp, importer, "src", "failing.test.ts"), failingTest, "utf8");

    // Nix flakes read sources from git-tracked files; ensure the injected failing test and TARGETS
    // are visible to the flake evaluation inside the external runner.
    await $({
      env,
    })`bash --noprofile --norc -c '
      set -euo pipefail
      git -C ${tmp} add -A
      if git -C ${tmp} diff --cached --quiet; then
        echo \"expected staged changes for injected failing test, but index is empty\" >&2
        git -C ${tmp} status --porcelain=v1 || true
        exit 2
      fi
      git -C ${tmp} commit -m injected-failing-test
      git -C ${tmp} ls-files --error-unmatch ${importer}/src/failing.test.ts >/dev/null
    '`;

    // The scaffold already wires nix_node_test(name="unit", lockfile_label=...) in TARGETS.
    // Run the test target and assert failure is propagated to Buck.
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env,
    })`buck2 test //libs/demo:unit`.nothrow();
    console.error("[debug] buck2 exitCode=", res.exitCode);
    if (res.stdout) console.error("[debug] buck2 stdout:\n" + res.stdout);
    if (res.stderr) console.error("[debug] buck2 stderr:\n" + res.stderr);
    if (res.exitCode === 0) {
      throw new Error("expected buck2 test to fail when importer tests fail");
    }
  });
});
