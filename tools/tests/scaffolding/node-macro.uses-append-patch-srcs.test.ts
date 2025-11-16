#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node macros use append_patch_srcs helper for importer-local patches", async () => {
  const txt = await fsp.readFile("node/defs.bzl", "utf8");
  // After PR‑3 refactor, macros delegate to append_node_patches_for_importer
  assert.match(txt, /append_node_patches_for_importer\(/);
});
