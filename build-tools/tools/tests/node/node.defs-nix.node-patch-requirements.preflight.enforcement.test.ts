#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("build-tools/node/defs_nix.bzl runs node patch requirement preflight for all entrypoints", async () => {
  const file = "build-tools/node/defs_nix.bzl";
  const txt = await fsp.readFile(file, "utf8");

  const preflightCalls = (txt.match(/nix_calling_node_patch_requirements_preflight\(/g) || [])
    .length;
  assert(preflightCalls === 3, `${file} must run preflight in webapp and both cli routes`);
  assert(
    txt.includes('"//build-tools/lang:nix_shell.bzl"') &&
      txt.includes('"nix_calling_node_patch_requirements_preflight"'),
    `${file} must load shared node patch preflight helper from nix_shell.bzl`,
  );
});
