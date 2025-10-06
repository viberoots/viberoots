#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp kindOf maps binary/lib/test correctly", async () => {
  await runInTemp("planner-cpp-kind", async (tmp, $) => {
    // Prepare manifest and plugin
    const manifest = {
      enabled: ["cpp"],
      languages: [
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: ["tools/nix/planner/cpp.nix"],
          kinds: ["bin", "lib", "test"],
          templatesDir: "tools/scaffolding/templates/cpp",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await fs.copy(
      path.join(process.cwd(), "tools/nix/planner/cpp.nix"),
      path.join(tmp, "tools/nix/planner/cpp.nix"),
    );

    // Directly import the plugin via Nix eval and test kindOf on mock nodes
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        ctx = {
          lib = lib;
          get = n: k: if builtins.hasAttr k n then n.${"${k}"} else null;
          pkgPathOf = name: ".";
          T = {};
          repoRoot = ./.;
        };
        plugin = (import ./tools/nix/planner/cpp.nix { inherit lib; }) ctx;
        k1 = plugin.kindOf { rule_type = "cxx_binary"; };
        k2 = plugin.kindOf { rule_type = "cxx_library"; };
        k3 = plugin.kindOf { rule_type = "cxx_test"; };
        k4 = plugin.kindOf { rule_type = "other"; };
      in { inherit k1 k2 k3 k4; }
    `;
    const out = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const obj = JSON.parse(String(out.stdout || "{}"));
    assert.equal(obj.k1, "bin");
    assert.equal(obj.k2, "lib");
    assert.equal(obj.k3, "test");
    assert.equal(obj.k4, null);
  });
});
