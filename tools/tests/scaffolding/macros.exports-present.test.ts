#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import * as fsp from "node:fs/promises";

test("go/defs.bzl exports nix_go_* macros and uses shared providers_for", async () => {
  await runInTemp("macros-exports", async (tmp, $) => {
    const txt = await fsp.readFile("go/defs.bzl", "utf8");
    const need = [
      "def nix_go_library(",
      "def nix_go_binary(",
      "def nix_go_test(",
      // Ensure we are delegating to the shared helper, not defining a local _providers_for
      'load("//lang:defs_common.bzl", "append_tuple_labels", "dedupe_preserve", "normalize_labels", "stamp_labels", "normalize_nix_attr", "append_patch_srcs", "providers_for")',
      "providers_for(",
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
  });
});
