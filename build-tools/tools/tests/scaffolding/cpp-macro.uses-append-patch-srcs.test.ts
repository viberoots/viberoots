#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("cpp macros use shared helper for local patches", async () => {
  const txt = await fsp.readFile(viberootsSourcePath("viberoots/build-tools/cpp/defs.bzl"), "utf8");
  assert.match(txt, /prepare_language_wiring\(/);
  assert.doesNotMatch(
    txt,
    /include_package_local_patches\(/,
    "cpp macros must not call include_package_local_patches directly; use @viberoots//build-tools/lang:defs_common.bzl:prepare_language_wiring",
  );
});
