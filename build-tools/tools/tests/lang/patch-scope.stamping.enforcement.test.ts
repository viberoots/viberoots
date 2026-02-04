#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const macroImplFiles = [
  "go/defs.bzl",
  "cpp/defs.bzl",
  "node/defs_core.bzl",
  "node/defs_nix.bzl",
  "python/defs.bzl",
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
