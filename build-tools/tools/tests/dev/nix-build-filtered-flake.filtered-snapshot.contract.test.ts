#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("filtered flake builds use bundle source authority without ambient selectors", async () => {
  const helper = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/nix-build-filtered-flake.ts"),
    "utf8",
  );
  const planner = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/graph-generator.nix"),
    "utf8",
  );

  assert.ok(
    helper.includes('VBR_FILTERED_FLAKE_SNAPSHOT: "1"'),
    "expected nix-build-filtered-flake to mark filtered snapshot builds",
  );
  assert.ok(
    planner.includes(
      'filteredFlakeSnapshot = evaluationBundle != null || (builtins.getEnv "VBR_FILTERED_FLAKE_SNAPSHOT") != "";',
    ),
    "expected graph-generator to recognize the registered evaluation bundle",
  );
  assert.ok(
    planner.includes("if filteredFlakeSnapshot then builtins.toString src"),
    "expected graph-generator to prefer flake src when the snapshot marker is set",
  );
  assert.ok(
    planner.includes("if filteredFlakeSnapshot\n    then src"),
    "expected graph-generator to reuse the filtered flake src instead of re-filtering BUCK_TEST_SRC",
  );
  assert.match(
    planner,
    /selectedTargetName = if evaluationBundle == null[\s\S]*evaluationBundle\.selection\.target/,
  );
  assert.match(helper, /import \{ runCommand \} from "\.\/filtered-flake-command"/);
  assert.doesNotMatch(helper, /\$\s*\(/, "filtered builder must not depend on ambient zx globals");
});
