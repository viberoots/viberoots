#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner lib kindOf shared helper respects per-language configs", async () => {
  await runInTemp("planner-lib-kindof-shared", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        get = attrs: k: if builtins.hasAttr k attrs then attrs.\${k} else null;
        L = import ./tools/nix/planner/lib.nix { inherit lib get; nodes = []; };
        goCfg = {
          labelPriorityPre = [
            { label = "kind:carchive"; kind = "lib"; }
            { label = "kind:wasm"; kind = "tinywasm"; }
          ];
          ruleTypes = {
            suffixes = [ { suffix = "_binary"; kind = "bin"; } ];
            prefixes = [ { prefix = "go_"; kind = "lib"; } ];
          };
          labelPriorityPost = [ { label = "kind:bin"; kind = "bin"; } ];
          defaultKind = "lib";
        };
        cppCfg = {
          plannerStubs = [ { nameSuffix = "__planner"; kind = "test"; } ];
          labelPriorityPre = [
            { label = "kind:test"; kind = "test"; }
            { label = "kind:bin"; kind = "bin"; }
            { label = "kind:headers"; kind = "headers"; }
            { label = "kind:lib"; kind = "lib"; }
            { label = "kind:addon"; kind = "addon"; }
          ];
          ruleTypes = {
            equals = [
              { ruleType = "cxx_test"; kind = "test"; }
              { ruleType = "cxx_binary"; kind = "bin"; }
              { ruleType = "cxx_library"; kind = "lib"; }
            ];
          };
        };
        pyCfg = {
          labelPriorityPre = [
            { label = "kind:wasm"; kind = "wasm"; }
            { label = "kind:pyext_wasm"; kind = "pyext_wasm"; }
            { label = "kind:pyext"; kind = "pyext"; }
            { label = "kind:test"; kind = "test"; }
          ];
          ruleTypes = {
            suffixes = [
              { suffix = "_binary"; kind = "bin"; }
              { suffix = "_test"; kind = "test"; }
            ];
          };
          labelPriorityPost = [ { label = "kind:bin"; kind = "bin"; } ];
          defaultKind = "lib";
        };
        goA = L.kindOf { labels = [ "kind:carchive" "kind:bin" ]; ruleType = "go_binary"; name = "//apps/goapp:goapp"; config = goCfg; };
        goB = L.kindOf { labels = [ "lang:go" ]; ruleType = "go_binary"; config = goCfg; };
        goC = L.kindOf { labels = [ "kind:bin" ]; ruleType = "other"; config = goCfg; };
        cppA = L.kindOf { labels = [ "kind:lib" ]; ruleType = "cxx_library"; name = "//apps/cpp:demo__planner"; config = cppCfg; };
        cppB = L.kindOf { labels = []; ruleType = "cxx_binary"; config = cppCfg; };
        cppC = L.kindOf { labels = []; ruleType = "other"; config = cppCfg; };
        pyA = L.kindOf { labels = [ "kind:pyext" ]; ruleType = "python_library"; config = pyCfg; };
        pyB = L.kindOf { labels = []; ruleType = "python_test"; config = pyCfg; };
        pyC = L.kindOf { labels = [ "kind:bin" ]; ruleType = "other"; config = pyCfg; };
      in { inherit goA goB goC cppA cppB cppC pyA pyB pyC; }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const obj = JSON.parse(String(stdout || "{}"));
    assert.equal(obj.goA, "lib");
    assert.equal(obj.goB, "bin");
    assert.equal(obj.goC, "bin");
    assert.equal(obj.cppA, "test");
    assert.equal(obj.cppB, "bin");
    assert.equal(obj.cppC, null);
    assert.equal(obj.pyA, "pyext");
    assert.equal(obj.pyB, "test");
    assert.equal(obj.pyC, "bin");
  });
});
