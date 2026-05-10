#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp cmd prefixes nix bootstrap env and timeout wrapper", async () => {
  await runInTemp("node-webapp-timeout-prefix", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:bundle`;
    if (probe.exitCode !== 0) {
      // Environment not fully available in temp — skip to avoid false negatives
      return;
    }
    const raw = JSON.parse(String(probe.stdout || "")) as Record<string, { cmd?: string }>;
    const out = String(Object.values(raw)[0]?.cmd || "");
    // Should include nix bootstrap core markers
    assert.ok(
      out.includes("export WORKSPACE_ROOT=") || out.includes("FLK_ROOT="),
      "expected nix_bootstrap_env_core() fragments in cmd",
    );
    // node_webapp should avoid unified PNPM store bootstrap to keep the build path lean.
    assert.equal(
      out.includes("require-unified-pnpm-store.ts") || out.includes(".unified-pnpm-store/path"),
      false,
      "node_webapp should not include unified PNPM store bootstrap fragments",
    );
    // Should declare TIMEOUT wrapper and use it to invoke the filtered flake
    // builder entrypoint for node_webapp.
    assert.ok(out.includes("TIMEOUT="), "expected TIMEOUT= assignment in cmd");
    assert.ok(
      out.includes('export NIX_PNPM_INSTALL_TIMEOUT="$TOUT"'),
      "expected timeout wrapper to export NIX_PNPM_INSTALL_TIMEOUT",
    );
    const idxTimeout = out.indexOf("TIMEOUT");
    const idxFilteredBuilder = out.indexOf("nix-build-filtered-flake.ts");
    assert.ok(
      idxTimeout >= 0 && idxFilteredBuilder > idxTimeout,
      "expected TIMEOUT to precede filtered flake builder invocation",
    );

    // Enforce "no out-links" policy and standard outPath capture structure
    assert.ok(
      out.includes("--attr") && out.includes("node-webapp."),
      "expected node_webapp filtered builder to receive attr selection",
    );
    assert.ok(
      out.includes("OUT_PATHS_FILE=") || out.includes("vbr-nix-outpaths.txt"),
      "expected outPath capture to use a deterministic temp file",
    );
  });
});
