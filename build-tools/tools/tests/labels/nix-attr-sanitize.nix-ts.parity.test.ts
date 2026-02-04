#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeAttrNameFromLabel } from "../../lib/labels";
import { runInTemp } from "../lib/test-helpers";

test("TS ↔ Nix sanitizeAttrNameFromTargetLabel parity", async () => {
  await runInTemp("nix-attr-sanitize-nix-ts-parity", async (tmp, $) => {
    const cases: string[] = [
      "root//apps/foo:svc (config//toolchains:default#buck2/default//:default#linkerlang/cxx)",
      "prelude//build-tools/cpp:lib (config//toolchains:xyz)",
      "//apps/foo:my bin",
      "root//apps/foo:my@target",
      "apps/foo:svc (config//buck:some)",
      "root//third_party/providers:prov (root//:no_cgo#6eb543497f051f11)",
      "//a:b/c",
      "//UPPER:Case With Spaces",
    ];

    const tsOut = cases.map((c) => sanitizeAttrNameFromLabel(c)).sort();

    const expr = `
      let
        pkgs = import <nixpkgs> {};
        H = import ./build-tools/tools/nix/lib/lang-helpers.nix { inherit pkgs; };
        cases = builtins.fromJSON ${JSON.stringify(JSON.stringify(cases))};
      in builtins.sort builtins.lessThan (map H.sanitizeAttrNameFromTargetLabel cases)
    `;

    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const nixOut = JSON.parse(String(stdout || "[]")) as string[];

    assert.deepEqual(
      nixOut,
      tsOut,
      `Mismatch.\nTS:  ${JSON.stringify(tsOut)}\nNix: ${JSON.stringify(nixOut)}`,
    );
  });
});
