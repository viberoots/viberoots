#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const macroImplFiles = [
  "viberoots/build-tools/go/defs.bzl",
  "viberoots/build-tools/cpp/defs.bzl",
  "viberoots/build-tools/node/defs_core.bzl",
  "viberoots/build-tools/node/defs_nix.bzl",
  "viberoots/build-tools/python/defs.bzl",
  "viberoots/build-tools/rust/defs.bzl",
];

test("language macros must not stamp patch_scope:* directly (delegate to shared wiring helpers)", async () => {
  for (const file of macroImplFiles) {
    const txt = await fsp.readFile(file, "utf8");

    assert(
      !txt.includes("patch_scope:"),
      `${file} must not include patch_scope:* labels directly; patch scope is stamped by shared wiring helpers`,
    );
    assert(
      !txt.includes("stamp_patch_scope("),
      `${file} must not call stamp_patch_scope(...); patch scope is stamped by shared wiring helpers`,
    );
    assert(
      !txt.includes("stamp_patch_scope_for_lang("),
      `${file} must not call stamp_patch_scope_for_lang(...); patch scope is stamped by shared wiring helpers`,
    );
  }
});
