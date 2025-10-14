#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTargetsFile } from "../../lib/fs-helpers";

test("renderTargetsFile: header-only yields deterministic trailing newline", async () => {
  const header = [
    "# GENERATED FILE — DO NOT EDIT.",
    'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
    "",
    "",
  ].join("\n");
  const out = renderTargetsFile(header, []);
  // For header-only, renderTargetsFile preserves header exactly (no forced newline)
  const expected = header;
  assert.equal(out, expected, "header-only render should be stable and exact");
});
