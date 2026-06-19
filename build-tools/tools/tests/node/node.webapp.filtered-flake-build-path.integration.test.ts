#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("node_webapp builds via filtered flake helper (single default path)", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const txt = await fsp.readFile(path.join(here, "../../../node/defs_nix.bzl"), "utf8");
  if (!txt.includes("nix-build-filtered-flake.ts")) {
    throw new Error("node_webapp must invoke nix-build-filtered-flake.ts");
  }
  if (txt.includes("path:$WORKSPACE_ROOT#node-webapp.")) {
    throw new Error("node_webapp must not directly build from path:$WORKSPACE_ROOT flake ref");
  }
  if (!txt.includes("$VIBEROOTS_ROOT/build-tools/tools/dev/nix-build-filtered-flake.ts")) {
    throw new Error("node_webapp must invoke the filtered flake helper from VIBEROOTS_ROOT");
  }
  if (txt.includes("$WORKSPACE_ROOT/viberoots/build-tools/tools/dev/nix-build-filtered-flake.ts")) {
    throw new Error("node_webapp must not invoke the filtered flake helper from WORKSPACE_ROOT");
  }
});
