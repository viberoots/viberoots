#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node macros use append_patch_srcs helper for importer-local patches", async () => {
  const txt = await fsp.readFile("node/defs_core.bzl", "utf8");
  // Node macros delegate via include_importer_patches_from_labels to the unified importer helper.
  assert.match(txt, /include_importer_patches_from_labels\(/);
});
