#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("cpp macros use shared helper for local patches", async () => {
  const txt = await fsp.readFile("cpp/defs.bzl", "utf8");
  assert.match(txt, /prepare_package_local_wiring\(/);
  assert.doesNotMatch(
    txt,
    /include_package_local_patches\(/,
    "cpp macros must not call include_package_local_patches directly; use //lang:defs_common.bzl:prepare_package_local_wiring",
  );
});
