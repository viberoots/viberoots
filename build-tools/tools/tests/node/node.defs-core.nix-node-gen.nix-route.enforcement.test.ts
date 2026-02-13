#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("build-tools/node/defs_core.bzl routes nix_node_gen through graph-generator-selected wrapper", async () => {
  const file = "build-tools/node/defs_core.bzl";
  const txt = await fsp.readFile(file, "utf8");

  assert(
    txt.includes('planner_name = name + "__planner"'),
    `${file} must create a planner-visible companion target for nix_node_gen`,
  );
  assert(
    txt.includes('wiring = "nix_calling_genrule"'),
    `${file} must wire public nix_node_gen through nix_calling_genrule`,
  );
  assert(
    txt.includes("graph-generator-selected"),
    `${file} must build selected planner output for nix_node_gen wrapper`,
  );
  assert(
    txt.includes("nix_calling_node_patch_requirements_preflight("),
    `${file} must run node patch requirements preflight in nix_node_gen wrapper`,
  );
});
