#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp provider sync emits nix_attr_map with canonical attrs", async () => {
  await runInTemp("cpp-nix-attr-map", async (tmp, $) => {
    // Minimal graph with two attrs (one alias to test normalization)
    const graph = [
      { name: "//apps/a:bin", labels: ["lang:cpp", "nixpkg:pkgs.zlib"] },
      { name: "//apps/b:test", labels: ["lang:cpp", "nixpkg:pkgs.gtest"] },
    ];
    await fs.outputFile(path.join(tmp, "tools/buck/graph.json"), JSON.stringify(graph), "utf8");

    // Ensure defs exist so load() resolves in generated TARGETS.cpp.auto
    await fs.mkdirp(path.join(tmp, "third_party/providers"));
    await fs.copy(
      path.join(process.cwd(), "third_party/providers/defs_cpp.bzl"),
      path.join(tmp, "third_party/providers/defs_cpp.bzl"),
    );

    // Run the C++ providers sync scoped to tmp via the public CLI
    await $({ cwd: tmp })`node ${path.join(
      process.cwd(),
      "tools/buck/sync-providers.ts",
    )} --lang=cpp`;

    const mapFile = path.join(tmp, "third_party/providers/nix_attr_map.bzl");
    const txt = await fs.readFile(mapFile, "utf8");
    if (!/NIX_ATTR_MAP\s*=\s*\{/.test(txt)) {
      console.error("expected NIX_ATTR_MAP dict header");
      process.exit(2);
    }
    // Expect canonical googletest alias in mapping
    if (!/"nixpkg:pkgs\.googletest"/.test(txt)) {
      console.error("expected pkgs.gtest normalized → pkgs.googletest in mapping");
      process.exit(2);
    }
    // Expect zlib present
    if (!/"nixpkg:pkgs\.zlib"/.test(txt)) {
      console.error("expected pkgs.zlib present in mapping");
      process.exit(2);
    }
  });
});


