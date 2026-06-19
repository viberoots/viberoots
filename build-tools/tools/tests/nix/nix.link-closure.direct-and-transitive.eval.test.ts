#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("planner link-closure: resolves direct vs transitive deterministically", async () => {
  await runInTemp("nix-link-closure-basic", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        LC = import ./viberoots/build-tools/tools/nix/planner/link-closure.nix { lib = pkgs.lib; };

        byName = { A = {}; B = {}; C = {}; D = {}; };
        edges = {
          A = [ "B" "C" ];
          B = [ "D" ];
          C = [ ];
          D = [ ];
        };
        linkDepsOf = name: edges.\${name} or [];
      in {
        direct = LC.resolveLinkClosure {
          inherit byName linkDepsOf;
          roots = [ "A" ];
          defaultClosure = "direct";
        };
        transitive = LC.resolveLinkClosure {
          inherit byName linkDepsOf;
          roots = [ "A" ];
          defaultClosure = "transitive";
        };
      }
    `;

    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as { direct: string[]; transitive: string[] };

    assert.deepEqual(out.direct, ["A"]);
    // DFS preorder with stable edge order
    assert.deepEqual(out.transitive, ["A", "B", "D", "C"]);
  });
});
