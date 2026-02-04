#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("build-tools/node/defs_nix.bzl must not reintroduce local importer normalization helpers", async () => {
  const file = "build-tools/node/defs_nix.bzl";
  const txt = await fsp.readFile(file, "utf8");

  assert(
    !txt.includes("def _sanitize_importer_attr("),
    `${file} must not define _sanitize_importer_attr(...); use //build-tools/lang:importer_strings.bzl`,
  );
  assert(
    !txt.includes("def _basename_importer("),
    `${file} must not define _basename_importer(...); use //build-tools/lang:importer_strings.bzl`,
  );

  assert(
    txt.includes('load("//build-tools/lang:importer_strings.bzl",'),
    `${file} must load //build-tools/lang:importer_strings.bzl`,
  );
  assert(
    txt.includes("sanitize_importer_for_nix_attr("),
    `${file} must call sanitize_importer_for_nix_attr(...)`,
  );
  assert(txt.includes("importer_display_name("), `${file} must call importer_display_name(...)`);
});
