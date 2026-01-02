#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner BUCK_TARGET selection accepts cell-prefixed and config-suffixed labels", async () => {
  await runInTemp("planner-buck-target-selection-normalization", async (tmp, $) => {
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    const graph = [
      {
        name: "root//apps/foo:svc (config//toolchains:default#buck2/default//:default#linkerlang/cxx)",
        rule_type: "cxx_binary",
        labels: ["lang:cpp"],
      },
    ];
    await fsp.writeFile(
      path.join(tmp, "tools/buck/graph.json"),
      JSON.stringify(graph) + "\n",
      "utf8",
    );

    const expr = `
      let
        pkgs = import <nixpkgs> {};
        G = import ./tools/nix/graph-generator.nix {
          inherit pkgs;
          src = ./.;
          graphJsonPath = ./tools/buck/graph.json;
        };
      in (builtins.match "^missing-" (G.selected.name or "")) != null
    `;

    const variants = [
      "//apps/foo:svc",
      "root//apps/foo:svc",
      "//apps/foo:svc (config//toolchains:default#buck2/default//:default#linkerlang/cxx)",
      "root//apps/foo:svc (config//toolchains:default#buck2/default//:default#linkerlang/cxx)",
    ];

    for (const BUCK_TARGET of variants) {
      const { stdout } = await $({
        cwd: tmp,
        env: { ...process.env, BUCK_TARGET, PLANNER_ONLY_CPP: "1" },
      })`nix eval --impure --expr ${expr} --json`;
      const isMissing = JSON.parse(String(stdout || "false")) as boolean;
      assert.equal(
        isMissing,
        false,
        `expected selection to succeed for BUCK_TARGET=${BUCK_TARGET}`,
      );
    }
  });
});
