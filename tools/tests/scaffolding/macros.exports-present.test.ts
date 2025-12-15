#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import * as fsp from "node:fs/promises";

test("go/defs.bzl exports nix_go_* macros and uses shared realize_provider_edges", async () => {
  await runInTemp("macros-exports", async (tmp, $) => {
    const txt = await fsp.readFile("go/defs.bzl", "utf8");
    const need = [
      "def nix_go_library(",
      "def nix_go_binary(",
      "def nix_go_test(",
      // Ensure we are delegating to private helpers (policy lives in go/private)
      'load("//lang:defs_common.bzl", "dedupe_preserve", "normalize_labels", "stamp_labels", "include_package_local_patches", "realize_provider_edges")',
      'load("//go/private:cgo_wiring.bzl", "apply_go_rule_stable_defaults", "apply_go_tuple_labels", "configure_cgo_and_merge_deps")',
      "configure_cgo_and_merge_deps(",
    ];
    for (const needle of need) {
      if (!txt.includes(needle)) {
        console.error("missing export:", needle);
        process.exit(2);
      }
    }
    // Assert the old local helper is gone
    if (txt.includes("def _providers_for(")) {
      console.error("found deprecated export:", "def _providers_for(");
      process.exit(2);
    }

    // Policy lives in go/private; ensure that helper is present and uses shared provider-edge wiring.
    const privateTxt = await fsp.readFile("go/private/cgo_wiring.bzl", "utf8");
    const privateNeed = [
      'load("//lang:defs_common.bzl", "append_nixpkg_labels", "dedupe_preserve", "normalize_labels", "realize_provider_edges")',
      'load("//go/private:labels.bzl", "append_tuple_labels")',
      "realize_provider_edges(",
    ];
    for (const needle of privateNeed) {
      if (!privateTxt.includes(needle)) {
        console.error("missing go/private contract:", needle);
        process.exit(2);
      }
    }
  });
});
