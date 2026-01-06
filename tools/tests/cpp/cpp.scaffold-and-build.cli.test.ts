#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp cli scaffold builds via planner (binary exists)", async () => {
  await runInTemp("cpp-scaffold-build-cli", async (tmp, $) => {
    // Manifest enabling C++ for planner
    const langs = {
      enabled: ["cpp"],
      languages: [
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: ["tools/nix/planner/cpp.nix", "tools/nix/templates/cpp.nix"],
          kinds: ["bin", "lib", "test"],
          templatesDir: "tools/scaffolding/templates/cpp",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "tools/nix/langs.json"),
      JSON.stringify(langs, null, 2) + "\n",
      "utf8",
    );

    // Copy planner + template + macros
    await fs.mkdirp(path.join(tmp, "tools/nix/planner"));
    await fs.copy(
      path.join(process.cwd(), "tools/nix/planner/cpp.nix"),
      path.join(tmp, "tools/nix/planner/cpp.nix"),
    );
    await fs.mkdirp(path.join(tmp, "tools/nix/templates"));
    await fs.copy(
      path.join(process.cwd(), "tools/nix/templates/cpp.nix"),
      path.join(tmp, "tools/nix/templates/cpp.nix"),
    );
    await fs.mkdirp(path.join(tmp, "cpp"));
    await fs.copy(path.join(process.cwd(), "cpp/defs.bzl"), path.join(tmp, "cpp/defs.bzl"));

    // Scaffold a minimal CLI under apps/demo
    const appDir = path.join(tmp, "apps/demo");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.outputFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n", "utf8");
    const targets = [
      'load("//cpp:defs.bzl", "nix_cpp_binary")',
      "",
      "nix_cpp_binary(",
      '    name = "demo",',
      '    srcs = ["src/main.cpp"],',
      '    labels = ["lang:cpp", "kind:bin"],',
      ")",
      "",
    ].join("\n");
    await fs.outputFile(path.join(appDir, "TARGETS"), targets, "utf8");

    // Simulated graph for planner
    const graphNodes = [
      {
        name: "//apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["apps/demo/src/main.cpp"],
      },
    ];
    const graphPath = path.join(tmp, "tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graphPath));
    await fs.writeFile(graphPath, JSON.stringify(graphNodes, null, 2) + "\n", "utf8");

    // Guard and build
    await $({ cwd: tmp })`node tools/buck/prebuild-guard.ts`.nothrow();
    const flake = path.join(process.cwd(), "tools/nix/graph-generator.nix");
    const system = process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
    const res = await $({
      cwd: tmp,
    })`nix build --accept-flake-config -f ${flake} --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphPath} --no-link --print-out-paths`.nothrow();
    assert.equal(res.exitCode, 0, "planner build should succeed for cpp bin");
  });
});
