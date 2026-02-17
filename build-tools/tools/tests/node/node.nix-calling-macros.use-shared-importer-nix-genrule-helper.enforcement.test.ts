#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("node Nix-calling macros route through unified wiring helper", async () => {
  const file = "build-tools/node/defs_nix.bzl";
  const helperFile = "build-tools/node/defs_nix_helpers.bzl";
  const txt = await fsp.readFile(file, "utf8");
  const helperTxt = await fsp.readFile(helperFile, "utf8");

  const helperCalls = (helperTxt.match(/prepare_language_wiring\(/g) || []).length;
  assert(
    helperCalls === 1,
    `${helperFile} must contain exactly one direct call to prepare_language_wiring(...); found ${helperCalls}`,
  );

  assert(
    txt.includes('load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")'),
    `${file} must load MODULE_PROVIDERS via //build-tools/lang:auto_map.bzl so provider edges are realized consistently`,
  );
  assert(
    helperTxt.includes("MODULE_PROVIDERS = MODULE_PROVIDERS"),
    `${helperFile} must pass MODULE_PROVIDERS into prepare_language_wiring(...)`,
  );

  assert(
    !txt.includes("wire_global_nix_inputs("),
    `${file} must not call wire_global_nix_inputs(...) directly; the shared helper owns global input wiring`,
  );
  assert(
    !txt.includes("prepare_importer_non_genrule_wiring("),
    `${file} must not call prepare_importer_non_genrule_wiring(...); use the shared helper for nix-calling genrules`,
  );
  assert(
    !txt.includes("prepare_importer_genrule_kwargs("),
    `${file} must not call prepare_importer_genrule_kwargs(...); use the shared helper for nix-calling genrules`,
  );
  assert(
    !txt.includes("prepare_importer_nix_calling_genrule_wiring_legacy_mutating("),
    `${file} must not call prepare_importer_nix_calling_genrule_wiring_legacy_mutating(...)`,
  );
});
