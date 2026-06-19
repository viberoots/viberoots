#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner lib helpers normalize labels, deps, and srcs", async () => {
  await runInTemp("planner-lib-helpers", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        get = attrs: k: if builtins.hasAttr k attrs then builtins.getAttr k attrs else null;
        nodes = [
          {
            name = "//projects/apps/demo:demo (config//platforms:default#abc)";
            labels = [ "x" "y" ];
            deps = [ "//projects/apps/demo:lib (config//platforms:default#def)" ];
            srcs = [ "root//projects/apps/demo/src/main.cpp" ];
          }
          {
            name = "//projects/apps/demo:lib";
            labels = [];
            deps = [];
            srcs = [ "root//projects/apps/demo/lib/foo.cpp" ];
          }
        ];
        pkgPathOf = name: "projects/apps/demo";
        L = import ./viberoots/build-tools/tools/nix/planner/lib.nix { inherit lib get nodes pkgPathOf; };
        n0 = builtins.elemAt nodes 0;
        out = {
          cleaned = L.cleanLabel n0.name;
          name0 = L.nameOf n0;
          deps0 = L.depsOf n0;
          srcsDemo = L.srcsOf "//projects/apps/demo:demo";
          srcsLib  = L.srcsOf "//projects/apps/demo:lib";
        };
      in out
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const obj = JSON.parse(String(stdout || "{}"));
    assert.equal(obj.cleaned, "//projects/apps/demo:demo");
    assert.equal(obj.name0, "//projects/apps/demo:demo");
    assert.deepEqual(obj.deps0, ["//projects/apps/demo:lib"]);
    assert.deepEqual(obj.srcsDemo, ["src/main.cpp"]);
    assert.deepEqual(obj.srcsLib, ["lib/foo.cpp"]);
  });
});
