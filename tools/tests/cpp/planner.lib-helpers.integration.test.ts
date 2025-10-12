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
            name = "//apps/demo:demo (config//platforms:default#abc)";
            labels = [ "x" "y" ];
            deps = [ "//apps/demo:lib (config//platforms:default#def)" ];
            srcs = [ "root//apps/demo/src/main.cpp" ];
          }
          {
            name = "//apps/demo:lib";
            labels = [];
            deps = [];
            srcs = [ "root//apps/demo/lib/foo.cpp" ];
          }
        ];
        pkgPathOf = name: "apps/demo";
        L = import ./tools/nix/planner/lib.nix { inherit lib get nodes pkgPathOf; };
        n0 = builtins.elemAt nodes 0;
        out = {
          cleaned = L.cleanLabel n0.name;
          name0 = L.nameOf n0;
          deps0 = L.depsOf n0;
          srcsDemo = L.srcsOf "//apps/demo:demo";
          srcsLib  = L.srcsOf "//apps/demo:lib";
        };
      in out
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const obj = JSON.parse(String(stdout || "{}"));
    assert.equal(obj.cleaned, "//apps/demo:demo");
    assert.equal(obj.name0, "//apps/demo:demo");
    assert.deepEqual(obj.deps0, ["//apps/demo:lib"]);
    assert.deepEqual(obj.srcsDemo, ["src/main.cpp"]);
    assert.deepEqual(obj.srcsLib, ["lib/foo.cpp"]);
  });
});
