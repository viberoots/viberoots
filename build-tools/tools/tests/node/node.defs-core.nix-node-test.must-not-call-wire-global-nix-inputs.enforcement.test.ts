#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("nix_node_test must not call wire_global_nix_inputs directly (enforced abstraction boundary)", async () => {
  const file = "viberoots/build-tools/node/defs_core.bzl";
  const txt = await fsp.readFile(file, "utf8");
  assert(
    !txt.includes("wire_global_nix_inputs("),
    `${file} must not call wire_global_nix_inputs(...); use prepare_language_wiring(...)`,
  );
});
