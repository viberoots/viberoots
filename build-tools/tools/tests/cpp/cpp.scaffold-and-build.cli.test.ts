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
          requiredPaths: [
            "build-tools/tools/nix/planner/cpp.nix",
            "build-tools/tools/nix/templates/cpp.nix",
          ],
          kinds: ["bin", "lib", "test"],
          templatesDir: "build-tools/tools/scaffolding/templates/cpp",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "build-tools/tools/nix/langs.json"),
      JSON.stringify(langs, null, 2) + "\n",
      "utf8",
    );

    // Copy planner + template + macros
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix/planner"));
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/planner/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/planner/cpp.nix"),
    );
    await fs.mkdirp(path.join(tmp, "build-tools/tools/nix/templates"));
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/templates/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/templates/cpp.nix"),
    );
    await fs.mkdirp(path.join(tmp, "build-tools", "cpp"));
    await fs.copy(
      path.join(process.cwd(), "build-tools/cpp/defs.bzl"),
      path.join(tmp, "build-tools/cpp/defs.bzl"),
    );

    // Scaffold a minimal CLI under apps/demo
    const appDir = path.join(tmp, "projects/apps/demo");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.outputFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n", "utf8");
    const targets = [
      'load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
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
        name: "//projects/apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["projects/apps/demo/src/main.cpp"],
      },
    ];
    const graphPath = path.join(tmp, "build-tools/tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graphPath));
    await fs.writeFile(graphPath, JSON.stringify(graphNodes, null, 2) + "\n", "utf8");

    // Guard and build
    await $({ cwd: tmp })`node build-tools/tools/buck/prebuild-guard.ts`.nothrow();
    const flake = path.join(process.cwd(), "build-tools/tools/nix/graph-generator.nix");
    const system = process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
    const res = await $({
      cwd: tmp,
    })`nix build --accept-flake-config -f ${flake} --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphPath} --no-link --print-out-paths`.nothrow();
    assert.equal(res.exitCode, 0, "planner build should succeed for cpp bin");
  });
});
