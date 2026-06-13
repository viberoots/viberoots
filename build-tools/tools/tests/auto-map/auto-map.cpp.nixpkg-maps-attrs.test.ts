#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("auto-map: C++ nixpkg labels map to providers", async () => {
  await runInTemp("auto-map-cpp-nixpkg", async (tmp, $) => {
    // Synthesize a small graph with one C++ node labeled by nixpkg attrs
    const graphPath = path.join(tmp, "buck-out/tmp/graph.json");
    await fs.mkdirp(path.dirname(graphPath));
    const nodes = [
      {
        name: "//projects/libs/cppdemo:lib",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "nixpkg:pkgs.zlib", "nixpkg:pkgs.googletest"],
      },
    ];
    await fs.writeFile(graphPath, JSON.stringify(nodes) + "\n", "utf8");

    const outPath = path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl");
    await $({
      cwd: tmp,
    })`node build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${outPath}`;
    const txt = await fs.readFile(outPath, "utf8");

    // Expect provider entries for both nixpkgs attrs
    assert.match(txt, /:nix_pkgs_zlib\b/, "expected provider for pkgs.zlib");
    assert.match(txt, /:nix_pkgs_googletest\b/, "expected provider for pkgs.googletest");
  });
});
