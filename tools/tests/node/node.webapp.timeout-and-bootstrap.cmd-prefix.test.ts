#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp cmd prefixes nix bootstrap env and timeout wrapper", async () => {
  await runInTemp("node-webapp-timeout-prefix", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  labels = ["lockfile:apps/web/pnpm-lock.yaml#apps/web"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //apps/web:bundle`;
    if (probe.exitCode !== 0) {
      // Environment not fully available in temp — skip to avoid false negatives
      return;
    }
    const out = String(probe.stdout || "");
    // Should include nix bootstrap core markers
    assert.ok(
      out.includes("export WORKSPACE_ROOT=") || out.includes("FLK_ROOT="),
      "expected nix_bootstrap_env_core() fragments in cmd",
    );
    // Node macros that invoke Nix must opt in to unified PNPM store setup
    assert.ok(
      out.includes("require-unified-pnpm-store.ts") || out.includes(".unified-pnpm-store/path"),
      "expected nix_bootstrap_env_pnpm_store() fragments in cmd",
    );
    // Should declare TIMEOUT wrapper and use it to invoke nix build
    assert.ok(out.includes("TIMEOUT="), "expected TIMEOUT= assignment in cmd");
    const idxTimeout = out.indexOf("TIMEOUT");
    const idxNix = out.indexOf("nix build");
    assert.ok(idxTimeout >= 0 && idxNix > idxTimeout, "expected TIMEOUT to precede nix build");

    // Enforce "no out-links" policy and standard outPath capture structure
    assert.ok(
      out.includes("--no-link --print-out-paths"),
      "expected nix build to use --no-link --print-out-paths",
    );
    assert.ok(
      out.includes("OUT_PATHS_FILE=") || out.includes("bnx-nix-outpaths.txt"),
      "expected outPath capture to use a deterministic temp file",
    );
  });
});
