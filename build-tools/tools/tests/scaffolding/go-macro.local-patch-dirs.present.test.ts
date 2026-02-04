#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("go macros declare local_patch_dirs and include *.patch globs", async () => {
  const txt = await fsp.readFile("build-tools/go/defs.bzl", "utf8");
  assert.match(txt, /local_patch_dirs/);
  assert.match(txt, /prepare_language_wiring\(/);
  assert.doesNotMatch(
    txt,
    /include_package_local_patches\(/,
    "go macros must not call include_package_local_patches directly; use //lang:defs_common.bzl:prepare_language_wiring",
  );
});
