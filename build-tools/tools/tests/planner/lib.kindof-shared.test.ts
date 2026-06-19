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
        L = import ./viberoots/build-tools/tools/nix/planner/lib.nix { inherit lib get; nodes = []; };
        kindConfigs = import ./viberoots/build-tools/tools/nix/planner/kind-configs.nix;
        goCfg = kindConfigs.go;
        cppCfg = kindConfigs.cpp;
        pyCfg = kindConfigs.python;
        nodeCfg = kindConfigs.node;
        goA = L.kindOf { labels = [ "kind:carchive" "kind:bin" ]; ruleType = "go_binary"; name = "//projects/apps/goapp:goapp"; config = goCfg; };
        goB = L.kindOf { labels = [ "lang:go" ]; ruleType = "go_binary"; config = goCfg; };
        goC = L.kindOf { labels = [ "kind:bin" ]; ruleType = "other"; config = goCfg; };
        cppA = L.kindOf { labels = [ "kind:lib" ]; ruleType = "cxx_library"; name = "//projects/apps/cpp:demo__planner"; config = cppCfg; };
        cppB = L.kindOf { labels = []; ruleType = "cxx_binary"; config = cppCfg; };
        cppC = L.kindOf { labels = []; ruleType = "other"; config = cppCfg; };
        pyA = L.kindOf { labels = [ "kind:pyext" ]; ruleType = "python_library"; config = pyCfg; };
        pyB = L.kindOf { labels = []; ruleType = "python_test"; config = pyCfg; };
        pyC = L.kindOf { labels = [ "kind:bin" ]; ruleType = "other"; config = pyCfg; };
        nodeA = L.kindOf { labels = [ "kind:bin" ]; ruleType = "node_rule"; config = nodeCfg; };
        nodeB = L.kindOf { labels = [ "kind:lib" ]; ruleType = "node_rule"; config = nodeCfg; };
        nodeC = L.kindOf { labels = [ "kind:gen" ]; ruleType = "node_rule"; config = nodeCfg; };
        nodeD = L.kindOf { labels = [ "kind:app" ]; ruleType = "node_rule"; config = nodeCfg; };
        nodeE = L.kindOf { labels = []; ruleType = "node_rule"; config = nodeCfg; };
      in { inherit goA goB goC cppA cppB cppC pyA pyB pyC nodeA nodeB nodeC nodeD nodeE; }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const obj = JSON.parse(String(stdout || "{}"));
    assert.equal(obj.goA, "bin");
    assert.equal(obj.goB, "bin");
    assert.equal(obj.goC, "bin");
    assert.equal(obj.cppA, "test");
    assert.equal(obj.cppB, "bin");
    assert.equal(obj.cppC, null);
    assert.equal(obj.pyA, "pyext");
    assert.equal(obj.pyB, "test");
    assert.equal(obj.pyC, "bin");
    assert.equal(obj.nodeA, "bin");
    assert.equal(obj.nodeB, "lib");
    assert.equal(obj.nodeC, "gen");
    assert.equal(obj.nodeD, "app");
    assert.equal(obj.nodeE, null);
  });
});
