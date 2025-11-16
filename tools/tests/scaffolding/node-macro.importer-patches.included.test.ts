#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node macros include importer-local patches via glob", async () => {
  const txt = await fsp.readFile("node/defs.bzl", "utf8");
  // Verify we derive importer from lockfile label
  assert.match(txt, /(extract_lockfile_labels|_extract_lockfile_labels)\(/);
  // Inclusion is delegated to the shared helper in lang/defs_common.bzl
  assert.match(txt, /append_node_patches_for_importer\(/);
});
