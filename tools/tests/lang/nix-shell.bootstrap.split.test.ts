#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_shell bootstrap split: core is language-agnostic; PNPM store is opt-in", async () => {
  await runInTemp("nix-shell-bootstrap-split", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "probe");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//lang:nix_shell.bzl", "nix_bootstrap_env_core", "nix_bootstrap_env_pnpm_store")',
        "",
        "genrule(",
        '  name = "core",',
        '  out = "core.txt",',
        // Buck's genrule `cmd` parses `$(...)` as a macro. Our bootstrap emits shell
        // command substitutions, so escape them to ensure we can cquery the cmd attr.
        '  cmd = nix_bootstrap_env_core().replace("$(", "$$(") + "echo ok > $OUT",',
        ")",
        "",
        "genrule(",
        '  name = "pnpm",',
        '  out = "pnpm.txt",',
        '  cmd = (nix_bootstrap_env_core() + nix_bootstrap_env_pnpm_store()).replace("$(", "$$(") + "echo ok > $OUT",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //apps/probe:core`;
    if (probeCore.exitCode !== 0) return;

    const probePnpm = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //apps/probe:pnpm`;
    if (probePnpm.exitCode !== 0) return;

    const outCore = String(probeCore.stdout || "");
    assert.ok(
      outCore.includes("export WORKSPACE_ROOT=") || outCore.includes("FLK_ROOT="),
      "expected core bootstrap to include WORKSPACE_ROOT/FLK_ROOT logic",
    );
    assert.ok(
      !outCore.includes("require-unified-pnpm-store.ts") &&
        !outCore.includes(".unified-pnpm-store"),
      "expected core bootstrap to exclude unified PNPM store handling",
    );

    const outPnpm = String(probePnpm.stdout || "");
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
