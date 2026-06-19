#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function countLines(file: string): Promise<number> {
  const txt = await fsp.readFile(file, "utf8");
  return txt.split(/\r?\n/).length;
}

test("selected *.bzl files remain under the 250 LOC methodology gate", async () => {
  const threshold = 250;
  const files = [
    "viberoots/build-tools/lang/defs_common.bzl",
    "viberoots/build-tools/lang/collections.bzl",
    "viberoots/build-tools/lang/label_stamping.bzl",
    "viberoots/build-tools/lang/lockfile_contracts.bzl",
    "viberoots/build-tools/lang/lockfile_labels.bzl",
    "viberoots/build-tools/lang/patch_inputs.bzl",
    "viberoots/build-tools/lang/importer_contracts.bzl",
    "viberoots/build-tools/lang/importer_wiring.bzl",
    "viberoots/build-tools/lang/importer_wiring_nix_calling.bzl",
    "viberoots/build-tools/lang/importer_wiring_probe.bzl",
    "viberoots/build-tools/lang/importer_wiring_primitives.bzl",
    "viberoots/build-tools/lang/nixpkg_labels.bzl",
    "viberoots/build-tools/lang/provider_edges.bzl",
    "viberoots/build-tools/lang/internal/importer_wiring.bzl",
    "viberoots/build-tools/lang/internal/importer_wiring_nix_calling.bzl",
    "viberoots/build-tools/lang/internal/importer_wiring_primitives.bzl",
    "viberoots/build-tools/lang/internal/nix_calling_importer_genrule_wiring.bzl",
    "viberoots/build-tools/lang/internal/package_local_wiring.bzl",

    "viberoots/build-tools/node/defs.bzl",
    "viberoots/build-tools/node/defs_core.bzl",
    "viberoots/build-tools/node/defs_nix.bzl",
  ];

  for (const f of files) {
    const lines = await countLines(f);
    assert.ok(lines <= threshold, `${f} exceeds ${threshold} LOC: ${lines} lines`);
  }
});
