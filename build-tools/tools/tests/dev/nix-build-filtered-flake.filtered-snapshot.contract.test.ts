#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("filtered flake builds mark the snapshot so graph-generator can reuse flake src", async () => {
  const helper = await fsp.readFile(
    "viberoots/build-tools/tools/dev/nix-build-filtered-flake.ts",
    "utf8",
  );
  const planner = await fsp.readFile("viberoots/build-tools/tools/nix/graph-generator.nix", "utf8");

  assert.ok(
    helper.includes('VBR_FILTERED_FLAKE_SNAPSHOT: "1"'),
    "expected nix-build-filtered-flake to mark filtered snapshot builds",
  );
  assert.ok(
    planner.includes(
      'filteredFlakeSnapshot = (builtins.getEnv "VBR_FILTERED_FLAKE_SNAPSHOT") != "";',
    ),
    "expected graph-generator to read the filtered snapshot marker",
  );
  assert.ok(
    planner.includes("if filteredFlakeSnapshot then builtins.toString src"),
    "expected graph-generator to prefer flake src when the snapshot marker is set",
  );
  assert.ok(
    planner.includes("if filteredFlakeSnapshot\n    then src"),
    "expected graph-generator to reuse the filtered flake src instead of re-filtering BUCK_TEST_SRC",
  );
});
