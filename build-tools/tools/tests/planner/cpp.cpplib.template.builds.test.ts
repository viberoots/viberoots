#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cppLib template builds a static archive", async () => {
  await runInTemp("cpp-lib-template", async (tmp, $) => {
    // Minimal manifest enabling cpp (requiredPaths include template path)
    const manifest = {
      enabled: ["cpp"],
      languages: [
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: [
            "build-tools/tools/nix/planner/cpp.nix",
            "build-tools/tools/nix/templates/cpp.nix",
          ],
          kinds: ["lib"],
          templatesDir: "build-tools/tools/scaffolding/templates/cpp",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "build-tools/tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    // Copy planner plugin and real template from repo under test
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/planner/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/planner/cpp.nix"),
    );
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/nix/templates/cpp.nix"),
      path.join(tmp, "build-tools/tools/nix/templates/cpp.nix"),
    );

    // Create a small C++ library source tree
    await fs.outputFile(path.join(tmp, "libs/demo/src/foo.cpp"), "int foo() { return 42; }\n");
    await fs.outputFile(path.join(tmp, "libs/demo/include/foo.h"), "int foo();\n");

    // Buck graph with one cxx_library; planner maps to cppLib
    const graph = [
      {
        name: "//projects/libs/demo:demo",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
      },
    ];
    await fs.outputFile(
      path.join(tmp, ".viberoots/workspace/buck/graph.json"),
      JSON.stringify(graph) + "\n",
    );

    // Build via graph-generator with this temp repo as src
    const flake = path.join(process.cwd(), "build-tools/tools/nix/graph-generator.nix");
    const res = await $({
      cwd: tmp,
    })`nix build --accept-flake-config -f ${flake} --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux"} --arg graphJsonPath ./.viberoots/workspace/buck/graph.json --no-link --print-out-paths`.nothrow();
    assert.equal(res.exitCode, 0);
  });
});
