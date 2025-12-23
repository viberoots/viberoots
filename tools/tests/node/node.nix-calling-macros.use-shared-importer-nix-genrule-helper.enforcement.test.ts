#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("node Nix-calling macros route through shared importer+nix genrule wiring helper", async () => {
  const file = "node/defs_nix.bzl";
  const txt = await fsp.readFile(file, "utf8");

  const helperCalls = (txt.match(/prepare_importer_nix_calling_genrule_wiring\(/g) || []).length;
  assert(
    helperCalls === 1,
    `${file} must contain exactly one direct call to prepare_importer_nix_calling_genrule_wiring(...); found ${helperCalls}`,
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
});
