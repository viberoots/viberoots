#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTargetLabel } from "../../lib/labels";
import { runInTemp } from "../lib/test-helpers";

test("TS ↔ Nix label normalization parity (cell + config suffix + abs/rel)", async () => {
  await runInTemp("labels-parity", async (tmp, $) => {
    const samples: string[] = [
      // cell + config suffix
      "root//projects/apps/foo:svc (config//toolchains:default#buck2/default//:default#linkerviberoots/build-tools/lang/cxx)",
      "prelude//build-tools/cpp:lib (config//toolchains:xyz)",
      // alternate suffix shape (platform / cfg hash)
      "//third_party/providers:prov (root//:no_cgo#6eb543497f051f11)",
      // absolute with config suffix
      "//projects/apps/foo:svc (config//buck:some)",
      // relative with config suffix
      "projects/apps/foo:svc (config//buck:some)",
      // no suffixes
      "root//projects/libs/helper:lib",
      "//projects/libs/helper:lib",
      "projects/libs/helper:lib",
      // bare target name (no package)
      "svc (config//foo:bar)",
      "svc",
    ];

    // Compute TS-normalized outputs
    const tsOut = samples.map((s) => normalizeTargetLabel(s));

    // Ask Nix to apply the canonical helper surface for the same inputs
    const listLiteral = `[ ${samples.map((s) => JSON.stringify(s)).join(" ")} ]`;
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        H = import ./viberoots/build-tools/tools/nix/lib/lang-helpers.nix { inherit pkgs; };
        normalize = s: H.normalizeTargetLabel s;
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
