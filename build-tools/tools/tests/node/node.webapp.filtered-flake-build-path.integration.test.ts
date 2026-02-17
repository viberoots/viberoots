#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node_webapp builds via filtered flake helper (single default path)", async () => {
  const txt = await fsp.readFile("build-tools/node/defs_nix.bzl", "utf8");
  if (!txt.includes("nix-build-filtered-flake.ts")) {
    throw new Error("node_webapp must invoke nix-build-filtered-flake.ts");
  }
  if (txt.includes("path:$WORKSPACE_ROOT#node-webapp.")) {
    throw new Error("node_webapp must not directly build from path:$WORKSPACE_ROOT flake ref");
  }
});
