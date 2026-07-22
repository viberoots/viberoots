#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";

test("canonical graph exporter rejects normalized nixpkg pin collisions", () => {
  assert.throws(
    () =>
      nodesFromCqueryJson({
        "root//projects/apps/demo:app": {
          rule_type: "rust_binary",
          nixpkg_pins: {
            gtest: { nixpkgs_profile: "default", rationale: "first spelling" },
            "pkgs.gtest": { nixpkgs_profile: "default", rationale: "second spelling" },
          },
        },
      }),
    /duplicate normalized nixpkg_pins key pkgs\.googletest/,
  );
});
