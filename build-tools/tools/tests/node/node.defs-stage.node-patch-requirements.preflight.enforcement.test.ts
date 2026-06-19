#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("build-tools/node/defs_stage.bzl runs node patch requirement preflight for stage entrypoints", async () => {
  const file = "viberoots/build-tools/node/defs_stage.bzl";
  const txt = await fsp.readFile(file, "utf8");

  const preflightCalls = (txt.match(/nix_calling_node_patch_requirements_preflight\(/g) || [])
    .length;
  assert(
    preflightCalls === 2,
    `${file} must run preflight in node_asset_stage and node_wasm_inline_module`,
  );
  assert(
    txt.includes('"@viberoots//build-tools/lang:nix_shell.bzl"') &&
      txt.includes('"nix_calling_node_patch_requirements_preflight"'),
    `${file} must load shared node patch preflight helper from the viberoots cell`,
  );
});
