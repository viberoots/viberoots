#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import * as fsp from "node:fs/promises";

test("go/defs.bzl exports nix_go_* macros and _providers_for", async () => {
  await runInTemp("macros-exports", async (tmp, $) => {
    const txt = await fsp.readFile("go/defs.bzl", "utf8");
    const need = [
      "def nix_go_library(",
      "def nix_go_binary(",
      "def nix_go_test(",
      "def _providers_for(",
    ];
    for (const needle of need) {
      if (!txt.includes(needle)) {
        console.error("missing export:", needle);
        process.exit(2);
      }
    }
  });
});
