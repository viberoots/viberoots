#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("cpp_nix_build builds via filtered flake helper instead of live repo flake", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const txt = await fsp.readFile(path.join(here, "../../../cpp/private/nix_build.bzl"), "utf8");
  if (!txt.includes("nix-build-filtered-flake.ts")) {
    throw new Error("cpp_nix_build must invoke nix-build-filtered-flake.ts");
  }
  if (!txt.includes("export VBR_NODE_ZX_INIT=")) {
    throw new Error("cpp_nix_build must export VBR_NODE_ZX_INIT before invoking node --import");
  }
  if (!txt.includes("$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs")) {
    throw new Error("cpp_nix_build must import zx-init from VIBEROOTS_ROOT");
  }
  if (!txt.includes("$VIBEROOTS_ROOT/build-tools/tools/dev/nix-build-filtered-flake.ts")) {
    throw new Error("cpp_nix_build must invoke the filtered flake helper from VIBEROOTS_ROOT");
  }
  if (txt.includes("$WORKSPACE_ROOT/viberoots/build-tools/tools/dev/nix-build-filtered-flake.ts")) {
    throw new Error("cpp_nix_build must not invoke the filtered flake helper from WORKSPACE_ROOT");
  }
  if (txt.includes("path:$FLK_ROOT#graph-generator-selected")) {
    throw new Error("cpp_nix_build must not directly build from path:$FLK_ROOT flake ref");
  }
});
