#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("cpp_nix_build builds via filtered flake helper instead of live repo flake", async () => {
  const txt = await fsp.readFile("build-tools/cpp/private/nix_build.bzl", "utf8");
  if (!txt.includes("nix-build-filtered-flake.ts")) {
    throw new Error("cpp_nix_build must invoke nix-build-filtered-flake.ts");
  }
  if (txt.includes("path:$FLK_ROOT#graph-generator-selected")) {
    throw new Error("cpp_nix_build must not directly build from path:$FLK_ROOT flake ref");
  }
});
