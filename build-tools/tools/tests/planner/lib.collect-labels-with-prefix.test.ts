#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("collectLabelsWithPrefix performs DFS, dedupes, sorts, and bounds", async () => {
  await runInTemp("planner-lib-collect-labels", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        get = attrs: k: if builtins.hasAttr k attrs then builtins.getAttr k attrs else null;
        # Synthetic graph:
        # A -> B, C; B -> D; C -> D; D -> (none)
        # Labels on nodes: D has two nixpkg labels; C has one; A has none; B duplicates one of D's labels
        nodes = [
          { name = "//apps/demo:A"; labels = []; deps = [ "//apps/demo:B" "//apps/demo:C" ]; srcs = []; }
          { name = "//apps/demo:B"; labels = [ "nixpkg:pkgs.zlib" ]; deps = [ "//apps/demo:D" ]; srcs = []; }
          { name = "//apps/demo:C"; labels = [ "nixpkg:pkgs.openssl" ]; deps = [ "//apps/demo:D" ]; srcs = []; }
          { name = "//apps/demo:D"; labels = [ "nixpkg:pkgs.zlib" "nixpkg:pkgs.libcurl" "misc:ignore" ]; deps = []; srcs = []; }
        ];
        pkgPathOf = name: "apps/demo";
        L = import ./build-tools/tools/nix/planner/lib.nix { inherit lib get nodes pkgPathOf; };
        fromA = L.collectLabelsWithPrefix "//apps/demo:A" "nixpkg:";
        fromB = L.collectLabelsWithPrefix "//apps/demo:B" "nixpkg:";
        fromD = L.collectLabelsWithPrefix "//apps/demo:D" "nixpkg:";
      in { inherit fromA fromB fromD; }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const obj = JSON.parse(String(stdout || "{}"));
    // DFS from A should include pkgs.libcurl, pkgs.openssl, pkgs.zlib exactly once each, sorted
    assert.deepEqual(obj.fromA, ["nixpkg:pkgs.libcurl", "nixpkg:pkgs.openssl", "nixpkg:pkgs.zlib"]);
    // From B should include libcurl and zlib (no openssl)
    assert.deepEqual(obj.fromB, ["nixpkg:pkgs.libcurl", "nixpkg:pkgs.zlib"]);
    // From D should include only its own labels (bounded DFS)
    assert.deepEqual(obj.fromD, ["nixpkg:pkgs.libcurl", "nixpkg:pkgs.zlib"]);
  });
});
