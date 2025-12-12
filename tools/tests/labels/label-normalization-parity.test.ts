#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { normalizeTargetLabel } from "../../lib/labels";

test("TS ↔ Nix label normalization parity (cell + config suffix + abs/rel)", async () => {
  await runInTemp("labels-parity", async (tmp, $) => {
    const samples: string[] = [
      // cell + config suffix
      "root//apps/foo:svc (config//toolchains:default#buck2/default//:default#linkerlang/cxx)",
      "prelude//cpp:lib (config//toolchains:xyz)",
      // alternate suffix shape (platform / cfg hash)
      "//third_party/providers:prov (root//:no_cgo#6eb543497f051f11)",
      // absolute with config suffix
      "//apps/foo:svc (config//buck:some)",
      // relative with config suffix
      "apps/foo:svc (config//buck:some)",
      // no suffixes
      "root//libs/helper:lib",
      "//libs/helper:lib",
      "libs/helper:lib",
      // bare target name (no package)
      "svc (config//foo:bar)",
      "svc",
    ];

    // Compute TS-normalized outputs
    const tsOut = samples.map((s) => normalizeTargetLabel(s));

    // Ask Nix to apply planner/lib.nix cleanLabel + drop cell prefix for the same inputs
    const listLiteral = `[ ${samples.map((s) => JSON.stringify(s)).join(" ")} ]`;
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        L = import ./tools/nix/planner/lib.nix { inherit lib; };
        dropCell = lbl:
          let parts = lib.splitString "//" lbl;
          in if (builtins.length parts) > 1 && !(lib.hasPrefix "//" lbl)
             then "//" + (builtins.elemAt parts 1)
             else lbl;
        normalize = s: let base = L.cleanLabel s; in dropCell base;
        ins = ${listLiteral};
      in map normalize ins
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const nixOut = JSON.parse(String(stdout || "[]")) as string[];

    assert.deepEqual(
      tsOut,
      nixOut,
      `Normalization mismatch.\nTS:  ${JSON.stringify(tsOut)}\nNix: ${JSON.stringify(nixOut)}`,
    );
  });
});
