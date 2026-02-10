#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_asset_stage and node_wasm_inline_module stamp lang:node and kind:gen", async () => {
  await runInTemp("node-stage-inline-stamp-gen", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(path.join(appDir, "assets"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(appDir, "assets", "logo.txt"), "logo\n", "utf8");
    await fsp.writeFile(path.join(appDir, "demo.wasm"), "\0asm\u0001\0\0\0", "binary");
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "nix_node_gen", "node_asset_stage", "node_wasm_inline_module")',
        "",
        "nix_node_gen(",
        '  name = "app_raw",',
        '  out = "dist_raw",',
        '  cmd = "mkdir -p \\"$OUT\\"; printf \'<html>ok</html>\\\\n\' > \\"$OUT/index.html\\"",',
        ")",
        "",
        "node_asset_stage(",
        '  name = "staged",',
        '  app = ":app_raw",',
        '  assets = [{"src": "assets/logo.txt", "dest": "assets/logo.txt"}],',
        '  out = "dist",',
        ")",
        "",
        "node_wasm_inline_module(",
        '  name = "inline_wasm",',
        '  src = "demo.wasm",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const stageProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/web:staged`;
    if (stageProbe.exitCode !== 0) return;
    const stageLabels = String(stageProbe.stdout || "");
    assert.match(stageLabels, /"lang:node"/, "expected lang:node label on node_asset_stage");
    assert.match(stageLabels, /"kind:gen"/, "expected kind:gen label on node_asset_stage");

    const inlineProbe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/web:inline_wasm`;
    if (inlineProbe.exitCode !== 0) return;
    const inlineLabels = String(inlineProbe.stdout || "");
    assert.match(
      inlineLabels,
      /"lang:node"/,
      "expected lang:node label on node_wasm_inline_module",
    );
    assert.match(inlineLabels, /"kind:gen"/, "expected kind:gen label on node_wasm_inline_module");
  });
});
