#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("go macros declare local_patch_dirs and include *.patch globs", async () => {
  const txt = await fsp.readFile("go/defs.bzl", "utf8");
  assert.match(txt, /local_patch_dirs/);
  assert.match(txt, /glob\(\["%s\/\*\.patch" % d\]\)/);
});
