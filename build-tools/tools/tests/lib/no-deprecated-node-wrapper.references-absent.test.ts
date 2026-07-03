#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "./test-helpers/source-paths";

test("no references remain to append_node_patches_for_importer", async () => {
  const txt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/lang/defs_common.bzl"),
    "utf8",
  );
  assert.ok(
    !txt.includes("append_node_patches_for_importer("),
    "deprecated helper append_node_patches_for_importer should be removed",
  );
});
