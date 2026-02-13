#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("build-selected runs node patch requirement preflight", async () => {
  const file = "build-tools/tools/dev/build-selected.ts";
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("enforce-node-patch-requirements.ts")) {
    throw new Error(`${file} must run enforce-node-patch-requirements.ts before nix build`);
  }
  if (!txt.includes('args: ["--check"]')) {
    throw new Error(`${file} must pass --check for read-only preflight`);
  }
});

test("node entrypoint macros use shared node patch preflight helper", async () => {
  const files = [
    "build-tools/node/defs_core.bzl",
    "build-tools/node/defs_nix.bzl",
    "build-tools/node/defs_stage.bzl",
  ];
  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    if (!txt.includes("nix_calling_node_patch_requirements_preflight(")) {
      throw new Error(`${file} must wire node patch preflight through shared nix helper`);
    }
  }
});
