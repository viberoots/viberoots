#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const importerScopedMacroImplFiles = [
  "build-tools/node/defs_core.bzl",
  "build-tools/node/defs_nix.bzl",
  "build-tools/python/defs.bzl",
  "build-tools/python/defs_pyext_wasm.bzl",
];

test("importer-scoped macros delegate lockfile parsing/enforcement to //lang:importer_wiring.bzl", async () => {
  for (const file of importerScopedMacroImplFiles) {
    const txt = await fsp.readFile(file, "utf8");

    assert(
      !txt.includes('load("//lang:lockfile_labels.bzl"'),
      `${file} must not load //lang:lockfile_labels.bzl directly; use shared wiring helpers`,
    );
    assert(
      !txt.includes('load("//lang:importer_wiring.bzl"'),
      `${file} must not load //lang:importer_wiring.bzl directly; use prepare_language_wiring(...)`,
    );
    assert(
      !txt.includes('load("//lang/internal:importer_wiring.bzl"'),
      `${file} must not load internal importer wiring; use prepare_language_wiring(...)`,
    );

    assert(
      txt.includes("prepare_language_wiring("),
      `${file} must use prepare_language_wiring(...) for importer-scoped macros`,
    );

    const legacyOrRemovedHelpers = [
      "prepare_importer_genrule_kwargs_legacy_mutating(",
      "prepare_importer_non_genrule_wiring_legacy_mutating(",
      "prepare_importer_srcsless_rule_wiring_legacy_mutating(",
      "prepare_importer_nix_calling_genrule_wiring_legacy_mutating(",
      "prepare_importer_genrule_kwargs_v2(",
      "prepare_importer_non_genrule_wiring_v2(",
      "prepare_importer_srcsless_rule_wiring_v2(",
      "prepare_importer_nix_calling_genrule_wiring_v2(",
      "prepare_importer_non_genrule_nix_calling_wiring_v2(",
    ];
    for (const needle of legacyOrRemovedHelpers) {
      assert(
        !txt.includes(needle),
        `${file} must not call ${needle} directly; legacy/migration-only helpers are forbidden in macro files`,
      );
    }
  }
});
