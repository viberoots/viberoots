#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("planner link-closure: per-dep overrides apply and unknown modes fail fast", async () => {
  await runInTemp("nix-link-closure-overrides", async (tmp, $) => {
    const graph = `
      byName = { A = {}; B = {}; C = {}; D = {}; };
      edges = {
        A = [ "B" "C" ];
        B = [ "D" ];
        C = [ ];
        D = [ ];
      };
      linkDepsOf = name: edges.\${name} or [];
    `;

    const expr = `
      let
        pkgs = import <nixpkgs> {};
        LC = import ./build-tools/tools/nix/planner/link-closure.nix { lib = pkgs.lib; };
        ${graph}
      in LC.resolveLinkClosure {
        inherit byName linkDepsOf;
        roots = [ "A" ];
        defaultClosure = "direct";
        overrides = { A = "transitive"; B = "direct"; };
      }
    `;

    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "[]")) as string[];
    assert.deepEqual(out, ["A", "B", "C"]);

    const badExpr = `
      let
        pkgs = import <nixpkgs> {};
        LC = import ./build-tools/tools/nix/planner/link-closure.nix { lib = pkgs.lib; };
        ${graph}
      in LC.resolveLinkClosure {
        inherit byName linkDepsOf;
        roots = [ "A" ];
        defaultClosure = "direct";
        overrides = { A = "banana"; };
      }
    `;

    const bad = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix eval --impure --expr ${badExpr} --json`.nothrow();
    assert.notEqual(bad.exitCode, 0);
    assert.match(String(bad.stderr || ""), /unknown closure mode/);
  });
});
