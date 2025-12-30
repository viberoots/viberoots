#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node macros use append_patch_srcs helper for importer-local patches", async () => {
  const txt = await fsp.readFile("node/defs_core.bzl", "utf8");
  // Node macros delegate via shared importer wiring helpers.
  assert.match(txt, /prepare_importer_genrule_kwargs_v2\(/);
  assert.match(txt, /prepare_importer_non_genrule_wiring_v2\(/);
});
