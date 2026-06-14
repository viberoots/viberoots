#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("build-tools/go/defs.bzl exports nix_go_* macros and uses shared realize_provider_edges", async () => {
  await runInTemp("macros-exports", async (tmp, $) => {
    const txt = await fsp.readFile("build-tools/go/defs.bzl", "utf8");
    const need = [
      "def nix_go_library(",
      "def nix_go_binary(",
      "def nix_go_test(",
      // Ensure we are delegating to private helpers (policy lives in go/private)
      'load("@viberoots//build-tools/lang:defs_common.bzl", "normalize_labels", "prepare_language_wiring")',
      'load("@viberoots//build-tools/go/private:cgo_wiring.bzl", "apply_go_rule_stable_defaults", "apply_go_tuple_labels", "configure_cgo_kwargs")',
      "prepare_language_wiring(",
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
    const privateTxt = await fsp.readFile("build-tools/go/private/cgo_wiring.bzl", "utf8");
    const privateNeed = [
      'load("@viberoots//build-tools/go/private:labels.bzl", "append_tuple_labels")',
      "def configure_cgo_kwargs(",
    ];
    for (const needle of privateNeed) {
      if (!privateTxt.includes(needle)) {
        console.error("missing go/private contract:", needle);
        process.exit(2);
      }
    }
  });
});
