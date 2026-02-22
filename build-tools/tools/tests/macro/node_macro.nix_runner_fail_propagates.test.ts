#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runInTemp } from "../lib/test-helpers";

// Verify that the nix_node_test external runner propagates test failures to Buck (non-zero).
const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "nix_node_test: buck2 test fails when importer tests fail",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // Ensure dev env so 'scaf' and 'buck2' resolve inside the temp repo
    process.env.TEST_NEED_DEV_ENV = "1";
    await runInTemp("node-macro-fail-propagates", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });

      await $`git init`;
      // IMPORTANT: rely on runInTemp's injected env (WORKSPACE_ROOT/HOME/etc). Do not spread
      // process.env here; Buck tests set WORKSPACE_ROOT/BUCK_TEST_SRC for the *outer* repo.
      await $`scaf new ts lib demo --yes --skip-lockfile-gen`;
      await $(
        {},
      )`bash --noprofile --norc -c 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

      const importer = "projects/libs/demo";
      // Overwrite TARGETS to enforce allow-generate semantics in the runner
      const targets = [
        'load("//build-tools/node:defs.bzl", "nix_node_lib", "nix_node_test")',
        "",
        "nix_node_lib(",
        '    name = "demo",',
        "    srcs = [],",
        '    out = "build.stamp",',
        '    cmd = "echo ok > $OUT",',
        '    lockfile_label = "lockfile:projects/libs/demo/pnpm-lock.yaml#projects/libs/demo",',
        ")",
        "",
        "nix_node_test(",
        '    name = "unit",',
        '    srcs = glob(["src/**/*.ts", "src/**/*.js", "test/**/*.ts", "test/**/*.js", "__tests__/**/*.ts", "__tests__/**/*.js"]),',
        '    lockfile_label = "lockfile:projects/libs/demo/pnpm-lock.yaml#projects/libs/demo",',
        "    env = {",
        '        "NIX_PNPM_ALLOW_GENERATE": "1",',
        '        "NIX_PNPM_FETCH_TIMEOUT": "300",',
        "    },",
        ")",
        "",
      ].join("\n");
      await fsp.mkdir(path.join(tmp, importer), { recursive: true });
      await fsp.writeFile(path.join(tmp, importer, "TARGETS"), targets, "utf8");

      // Ensure the importer lockfile exists at projects/libs/demo/pnpm-lock.yaml (some scaffolding flows
      // write at repo root). Then align the fixed-output hash mapping for the importer so nix_node_test
      // fails for the intended reason (test failures), not due to pnpm-store hash mismatch.
      await $`bash --noprofile --norc -c 'test -f pnpm-lock.yaml && [ ! -f projects/libs/demo/pnpm-lock.yaml ] && cp pnpm-lock.yaml projects/libs/demo/pnpm-lock.yaml || true'`;
      await $({
        stdio: "inherit",
      })`bash --noprofile --norc -c 'set -euo pipefail; NIX_PNPM_ALLOW_GENERATE=1 NIX_PNPM_FETCH_TIMEOUT=300 zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --force --lockfile projects/libs/demo/pnpm-lock.yaml'`;

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
      await $({})`bash --noprofile --norc -c '
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
      })`buck2 test //projects/libs/demo:unit`.nothrow();
      if (res.exitCode === 0) {
        console.error("[debug] buck2 exitCode=", res.exitCode);
        if (res.stdout) console.error("[debug] buck2 stdout:\n" + res.stdout);
        if (res.stderr) console.error("[debug] buck2 stderr:\n" + res.stderr);
        throw new Error("expected buck2 test to fail when importer tests fail");
      }
    });
  },
);
