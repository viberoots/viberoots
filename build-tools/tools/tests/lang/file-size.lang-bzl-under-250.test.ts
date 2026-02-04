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
    "build-tools/lang/defs_common.bzl",
    "build-tools/lang/collections.bzl",
    "build-tools/lang/label_stamping.bzl",
    "build-tools/lang/lockfile_contracts.bzl",
    "build-tools/lang/lockfile_labels.bzl",
    "build-tools/lang/patch_inputs.bzl",
    "build-tools/lang/importer_contracts.bzl",
    "build-tools/lang/importer_wiring.bzl",
    "build-tools/lang/importer_wiring_nix_calling.bzl",
    "build-tools/lang/importer_wiring_probe.bzl",
    "build-tools/lang/importer_wiring_primitives.bzl",
    "build-tools/lang/nixpkg_labels.bzl",
    "build-tools/lang/provider_edges.bzl",
    "build-tools/lang/internal/importer_wiring.bzl",
    "build-tools/lang/internal/importer_wiring_nix_calling.bzl",
    "build-tools/lang/internal/importer_wiring_primitives.bzl",
    "build-tools/lang/internal/nix_calling_importer_genrule_wiring.bzl",
    "build-tools/lang/internal/package_local_wiring.bzl",

    "build-tools/node/defs.bzl",
    "build-tools/node/defs_core.bzl",
    "build-tools/node/defs_nix.bzl",
  ];

  for (const f of files) {
    const lines = await countLines(f);
    assert.ok(lines <= threshold, `${f} exceeds ${threshold} LOC: ${lines} lines`);
  }
});
