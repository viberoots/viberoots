#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node macros include importer-local patches via glob", async () => {
  const txt = await fsp.readFile("node/defs.bzl", "utf8");
  // Verify we derive importer from lockfile label and include its patches dir
  assert.match(txt, /_extract_lockfile_labels\(/);
  assert.match(txt, /_patch_dir = "patches\/node" if _importer == "\." else/);
  // After PR‑5 refactor, inclusion is delegated to the shared helper.
  assert.match(txt, /append_patch_srcs\(/);
});
