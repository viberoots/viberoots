#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node macros include importer-local patches via glob", async () => {
  const txt = await fsp.readFile("node/defs_core.bzl", "utf8");
  // Inclusion is delegated to the shared importer wiring helper.
  assert.match(txt, /attach_importer_patch_inputs\(/);
});
