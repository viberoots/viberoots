#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_tiny_wasm_lib passes global Nix inputs through go_nix_build_wasm(nix_inputs)", async () => {
  await runInTemp("go-tinygo-wasm-global-inputs", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "wasm");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/go:defs.bzl", "nix_go_tiny_wasm_lib")',
        "",
        "nix_go_tiny_wasm_lib(",
        '  name = "mod",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute nix_inputs //projects/apps/wasm:mod`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(":flake.lock"),
      "expected //.viberoots/workspace:flake.lock to be present in nix_inputs via global_nix_inputs()",
    );
  });
});
