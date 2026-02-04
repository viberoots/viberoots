#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner lib node inspection helpers handle rule types and labels", async () => {
  await runInTemp("planner-lib-node-inspection", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        get = attrs: k: if builtins.hasAttr k attrs then attrs.\${k} else null;
        nodes = [
          { name = "//apps/goapp:goapp"; rule_type = "go_binary"; labels = [ "lang:go" "kind:bin" ]; }
          { name = "//apps/cppapp:cppapp"; rule_type = "my_cpp_nix_build_rule"; labels = []; }
        ];
        L = import ./build-tools/tools/nix/planner/lib.nix { inherit lib get nodes; };
        nGo = builtins.elemAt nodes 0;
        nCpp = builtins.elemAt nodes 1;
        isGo = (L.isTargetByRuleTypeOrLabel { ruleTypePrefixes = [ "go_" ]; label = "lang:go"; }) nGo;
        isCpp = (L.isTargetByRuleTypeOrLabel { ruleTypePrefixes = [ "cxx_" ]; ruleTypeInfixes = [ "cpp_nix_build" ]; label = "lang:cpp"; }) nCpp;
        goKind = L.kindFromRuleType (L.ruleTypeOf nGo) {
          suffixes = [ { suffix = "_binary"; kind = "bin"; } ];
          prefixes = [ { prefix = "go_"; kind = "lib"; } ];
        };
        labelKind = L.kindFromLabels [ "kind:test" "kind:bin" ] [
          { label = "kind:test"; kind = "test"; }
          { label = "kind:bin"; kind = "bin"; }
        ];
      in { inherit isGo isCpp goKind labelKind; }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const obj = JSON.parse(String(stdout || "{}"));
    assert.equal(obj.isGo, true);
    assert.equal(obj.isCpp, true);
    assert.equal(obj.goKind, "bin");
    assert.equal(obj.labelKind, "test");
  });
});
