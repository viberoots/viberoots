#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("nix_node_test must not call wire_global_nix_inputs directly (enforced abstraction boundary)", async () => {
  const file = "node/defs_core.bzl";
  const txt = await fsp.readFile(file, "utf8");
  assert(
    !txt.includes("wire_global_nix_inputs("),
    `${file} must not call wire_global_nix_inputs(...); use prepare_importer_non_genrule_nix_calling_wiring(...)`,
  );
});
