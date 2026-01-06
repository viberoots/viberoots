#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp lib scaffold builds via planner (archive exists)", async () => {
  await runInTemp("cpp-scaffold-build-lib", async (tmp, $) => {
    // Write minimal langs manifest enabling cpp in the temp repo
    const langs = {
      enabled: ["cpp"],
      languages: [
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: ["tools/nix/planner/cpp.nix", "tools/nix/templates/cpp.nix"],
          kinds: ["lib", "bin", "test"],
          templatesDir: "tools/scaffolding/templates/cpp",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "tools/nix/langs.json"),
      JSON.stringify(langs, null, 2) + "\n",
      "utf8",
    );

    // Copy planner plugin + template used by the planner into temp repo
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

    // Copy cpp macros so TARGETS can load //cpp:defs.bzl
    await fs.mkdirp(path.join(tmp, "cpp"));
    await fs.copy(path.join(process.cwd(), "cpp/defs.bzl"), path.join(tmp, "cpp/defs.bzl"));

    // Scaffold a minimal C++ library under libs/demo
    const libDir = path.join(tmp, "libs/demo");
    await fs.mkdirp(path.join(libDir, "include"));
    await fs.mkdirp(path.join(libDir, "src"));
    await fs.outputFile(path.join(libDir, "include", "demo.h"), "int foo();\n", "utf8");
    await fs.outputFile(
      path.join(libDir, "src", "demo.cpp"),
      "#include <demo.h>\nint foo(){return 42;}\n",
      "utf8",
    );
    const targets = [
      'load("//cpp:defs.bzl", "nix_cpp_library")',
      "",
      "nix_cpp_library(",
      '    name = "demo",',
      '    srcs = ["src/demo.cpp"],',
      '    labels = ["lang:cpp", "kind:lib"],',
      ")",
      "",
    ].join("\n");
    await fs.outputFile(path.join(libDir, "TARGETS"), targets, "utf8");

    // Create a simulated Buck graph JSON for planner consumption
    const graphNodes = [
      {
        name: "//libs/demo:demo",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["libs/demo/src/demo.cpp"],
      },
    ];
    const graphPath = path.join(tmp, "tools/buck/graph.json");
    await fs.mkdirp(path.dirname(graphPath));
    await fs.writeFile(graphPath, JSON.stringify(graphNodes, null, 2) + "\n", "utf8");

    // Run prebuild guard (should pass with generated graph and without providers)
    await $({ cwd: tmp })`node tools/buck/prebuild-guard.ts`.nothrow();

    // Build with planner via graph-generator.nix (function call, passing src and graph)
    const flake = path.join(process.cwd(), "tools/nix/graph-generator.nix");
    const system = process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
    const res = await $({
      cwd: tmp,
    })`nix build --accept-flake-config -f ${flake} --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphPath} --no-link --print-out-paths`.nothrow();
    assert.equal(res.exitCode, 0, "planner build should succeed for cpp lib");
  });
});
