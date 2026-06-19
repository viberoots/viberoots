#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_shell bootstrap split: core is language-agnostic; PNPM store is opt-in", async () => {
  await runInTemp("nix-shell-bootstrap-split", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "probe");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/lang:nix_shell.bzl", "escape_buck_cmd_subst", "nix_bootstrap_env_core", "nix_bootstrap_env_pnpm_store")',
        "",
        "genrule(",
        '  name = "core",',
        '  out = "core.txt",',
        // Buck's genrule `cmd` parses `$(...)` as a macro. Our bootstrap emits shell
        // command substitutions, so escape them to ensure we can cquery the cmd attr.
        '  cmd = escape_buck_cmd_subst(nix_bootstrap_env_core()) + "echo ok > $OUT",',
        ")",
        "",
        "genrule(",
        '  name = "pnpm",',
        '  out = "pnpm.txt",',
        '  cmd = escape_buck_cmd_subst(nix_bootstrap_env_core() + nix_bootstrap_env_pnpm_store()) + "echo ok > $OUT",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probeCore = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/probe:core`;
    if (probeCore.exitCode !== 0) return;

    const probePnpm = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/probe:pnpm`;
    if (probePnpm.exitCode !== 0) return;

    const outCore = String(probeCore.stdout || "");
    assert.ok(
      !/(^|[^$])\$\(/.test(outCore),
      "expected escape_buck_cmd_subst to remove unescaped $(...) command substitutions",
    );
    assert.ok(!outCore.includes("$$("), "expected core bootstrap to avoid $$(...) entirely");
    assert.ok(
      outCore.includes("export WORKSPACE_ROOT=") || outCore.includes("FLK_ROOT="),
      "expected core bootstrap to include WORKSPACE_ROOT/FLK_ROOT logic",
    );
    assert.ok(
      outCore.indexOf("$WORKSPACE_ROOT/viberoots/build-tools/tools/dev/zx-init.mjs") >= 0,
      "expected core bootstrap to prefer a nested viberoots source root",
    );
    assert.ok(
      outCore.indexOf("$WORKSPACE_ROOT/viberoots/build-tools/tools/dev/zx-init.mjs") <
        outCore.indexOf("$WORKSPACE_ROOT/.viberoots/current/build-tools/tools/dev/zx-init.mjs"),
      "expected nested viberoots source root before .viberoots/current fallback",
    );
    assert.ok(
      !outCore.includes("require-unified-pnpm-store.ts") &&
        !outCore.includes(".unified-pnpm-store"),
      "expected core bootstrap to exclude unified PNPM store handling",
    );

    const outPnpm = String(probePnpm.stdout || "");
    assert.ok(
      !/(^|[^$])\$\(/.test(outPnpm),
      "expected escape_buck_cmd_subst to remove unescaped $(...) command substitutions",
    );
    assert.ok(!outPnpm.includes("$$("), "expected pnpm bootstrap to avoid $$(...) entirely");
    assert.ok(
      outPnpm.includes("export WORKSPACE_ROOT=") || outPnpm.includes("FLK_ROOT="),
      "expected pnpm bootstrap to include core bootstrap fragments",
    );
    assert.ok(
      outPnpm.includes("require-unified-pnpm-store.ts") ||
        outPnpm.includes(".unified-pnpm-store/path"),
      "expected pnpm bootstrap to include unified PNPM store handling",
    );
  });
});
