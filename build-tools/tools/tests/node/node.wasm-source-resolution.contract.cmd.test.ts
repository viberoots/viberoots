#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node wasm source resolver contract is wired into stage and inline macros", async () => {
  await runInTemp("node-wasm-source-resolution-contract-cmd", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(path.join(appDir, "assets"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(path.join(appDir, "index.html"), "<html></html>\n", "utf8");
    await fsp.writeFile(path.join(appDir, "assets", "sample.wasm"), "sample", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module")',
        "",
        "node_asset_stage(",
        '  name = "staged",',
        '  app = "index.html",',
        '  assets = [{"src": "assets/sample.wasm", "artifact_name": "named.wasm", "dest": "wasm/sample.wasm"}],',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_wasm_inline_module(",
        '  name = "inline_mod",',
        '  src = "assets/sample.wasm",',
        '  artifact_glob = "*.wasm",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const staged = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:staged`;
    assert.equal(staged.exitCode, 0, String(staged.stderr || ""));
    const stagedCmd = String(staged.stdout || "");
    assert.match(stagedCmd, /resolve_node_wasm_artifact/);
    assert.match(stagedCmd, /ASSET_NAME='named\.wasm'/);
    assert.match(stagedCmd, /ambiguous wasm artifacts/);

    const inline = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:inline_mod`;
    assert.equal(inline.exitCode, 0, String(inline.stderr || ""));
    const inlineCmd = String(inline.stdout || "");
    assert.match(inlineCmd, /resolve_node_wasm_artifact/);
    assert.match(inlineCmd, /SRC_GLOB='\*\.wasm'/);
    assert.match(inlineCmd, /artifact_glob/);
  });
});
