#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const importerScopedMacroImplFiles = ["node/defs_core.bzl", "node/defs_nix.bzl", "python/defs.bzl"];

test("importer-scoped macros delegate lockfile parsing/enforcement to //lang:importer_wiring.bzl", async () => {
  for (const file of importerScopedMacroImplFiles) {
    const txt = await fsp.readFile(file, "utf8");

    assert(
      !txt.includes('load("//lang:lockfile_labels.bzl"'),
      `${file} must not load //lang:lockfile_labels.bzl directly; use importer_wiring helpers`,
    );

    assert(
      txt.includes("prepare_importer_genrule_kwargs(") ||
        txt.includes("prepare_importer_non_genrule_wiring(") ||
        txt.includes("prepare_importer_srcsless_rule_wiring(") ||
        txt.includes("prepare_importer_nix_calling_genrule_wiring(") ||
        txt.includes("prepare_importer_non_genrule_nix_calling_wiring("),
      `${file} must use the shared prepare_importer_* wiring helpers for importer-scoped macros`,
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
