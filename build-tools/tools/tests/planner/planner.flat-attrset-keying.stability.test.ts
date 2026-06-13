#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { sanitizeAttrNameFromLabel } from "../../lib/labels";
import { runInTemp } from "../lib/test-helpers";

test("planner flat attrset keying (cppTargetsFlat) stays stable", async () => {
  await runInTemp("planner-flat-attrset-keying", async (tmp, $) => {
    const graph = [
      {
        name: "root//projects/apps/foo:My Bin (config//toolchains:default#buck2/default//:default#linkerbuild-tools/lang/cxx)",
        rule_type: "cxx_binary",
        labels: ["lang:cpp"],
      },
      {
        name: "prelude//projects/libs/math:lib (config//toolchains:xyz)",
        rule_type: "cxx_library",
        labels: ["lang:cpp"],
      },
      {
        name: "//projects/libs/helper:my@target",
        rule_type: "cxx_library",
        labels: ["lang:cpp"],
      },
    ];
    await fsp.mkdir(path.join(tmp, "build-tools", "tools", "buck"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, ".viberoots/workspace/buck/graph.json"),
      JSON.stringify(graph) + "\n",
      "utf8",
    );

    const expected = graph.map((n) => sanitizeAttrNameFromLabel(n.name)).sort();

    const expr = `
      let
        pkgs = import <nixpkgs> {};
        G = import ./build-tools/tools/nix/graph-generator.nix {
          inherit pkgs;
          src = ./.;
          graphJsonPath = ./.viberoots/workspace/buck/graph.json;
        };
      in builtins.sort builtins.lessThan (builtins.attrNames G.cppTargetsFlat)
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const got = JSON.parse(String(stdout || "[]")) as string[];

    assert.deepEqual(got, expected);
  });
});
