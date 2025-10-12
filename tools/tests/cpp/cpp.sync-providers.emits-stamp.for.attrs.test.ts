#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-cpp emits provider stamps for nixpkg attrs in graph", async () => {
  await runInTemp("cpp-sync-providers-basic", async (tmp, $) => {
    // Minimal graph with two attrs
    const graph = [
      { name: "//apps/a:bin", labels: ["lang:cpp", "nixpkg:pkgs.zlib"] },
      { name: "//apps/b:test", labels: ["lang:cpp", "nixpkg:pkgs.gtest"] },
    ];
    await fs.outputFile(path.join(tmp, "tools/buck/graph.json"), JSON.stringify(graph), "utf8");

    // Ensure defs exist so load() resolves; copy from repo
    await fs.mkdirp(path.join(tmp, "third_party/providers"));
    await fs.copy(
      path.join(process.cwd(), "third_party/providers/defs_cpp.bzl"),
      path.join(tmp, "third_party/providers/defs_cpp.bzl"),
    );

    // Run the C++ providers sync scoped to tmp via the public CLI
    await $({
      cwd: tmp,
    })`node ${path.join(process.cwd(), "tools/buck/sync-providers.ts")} --lang=cpp`;

    const out = path.join(tmp, "third_party/providers/TARGETS.cpp.auto");
    const txt = await fs.readFile(out, "utf8");
    if (!/nix_cxx_provider\(\s*name\s*=\s*"nix_pkgs_pkgs_zlib"/m.test(txt)) {
      console.error("expected provider for pkgs.zlib");
      process.exit(2);
    }
    if (!/nix_cxx_provider\(\s*name\s*=\s*"nix_pkgs_pkgs_googletest"/m.test(txt)) {
      console.error("expected provider for pkgs.gtest normalized → pkgs.googletest");
      process.exit(2);
    }
  });
});
