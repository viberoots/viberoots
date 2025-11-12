#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("go macros declare local_patch_dirs and include *.patch globs", async () => {
  const txt = await fsp.readFile("go/defs.bzl", "utf8");
  assert.match(txt, /local_patch_dirs/);
  // After PR‑5 refactor, the macros delegate patch inclusion to a shared helper.
  assert.match(txt, /append_patch_srcs\(/);
});
