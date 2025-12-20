#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node macros include importer-local patches via glob", async () => {
  const txt = await fsp.readFile("node/defs_core.bzl", "utf8");
  // Inclusion is delegated to shared importer wiring helpers.
  assert.match(txt, /prepare_importer_genrule_kwargs\(/);
  assert.match(txt, /prepare_importer_non_genrule_wiring\(/);
});
