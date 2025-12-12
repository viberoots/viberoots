#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function countLines(file: string): Promise<number> {
  const txt = await fsp.readFile(file, "utf8");
  return txt.split(/\r?\n/).length;
}

test("lang/*.bzl files remain under the 250 LOC methodology gate", async () => {
  const threshold = 250;
  const files = [
    "lang/defs_common.bzl",
    "lang/collections.bzl",
    "lang/label_stamping.bzl",
    "lang/lockfile_labels.bzl",
    "lang/patch_inputs.bzl",
    "lang/nixpkg_labels.bzl",
    "lang/provider_edges.bzl",
  ];

  for (const f of files) {
    const lines = await countLines(f);
    assert.ok(lines <= threshold, `${f} exceeds ${threshold} LOC: ${lines} lines`);
  }
});
