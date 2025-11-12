#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("cpp macros use append_patch_srcs helper for local patches", async () => {
  const txt = await fsp.readFile("cpp/defs.bzl", "utf8");
  assert.match(txt, /append_patch_srcs\(/);
});
