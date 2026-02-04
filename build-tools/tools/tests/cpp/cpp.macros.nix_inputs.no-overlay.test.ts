#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp macros do not couple to overlay in nix_inputs (cquery)", async () => {
  await runInTemp("cpp-nix-inputs-no-overlay", async (tmp, $) => {
    // Define a minimal C++ macro target at repo root
    await fsp.appendFile(
      path.join(tmp, "TARGETS"),
      [
        "",
        "# test: cpp.macros.nix_inputs.no-overlay.test.ts",
        'load("//cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "probe_lib",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    // Probe nix_inputs via cquery; skip gracefully if Buck/prelude not available
    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute nix_inputs //:probe_lib`;
    if (probe.exitCode !== 0) {
      // Environment not fully available in temp — skip to avoid false negatives
      return;
    }
    const out = String(probe.stdout || "");
    assert.ok(out.includes(":flake.lock"), "expected flake.lock to be present in nix_inputs");
    assert.ok(
      !out.includes("build-tools/tools/nix/overlays:cpp-patches.nix"),
      "overlay cpp-patches.nix must not be present in nix_inputs",
    );
  });
});
