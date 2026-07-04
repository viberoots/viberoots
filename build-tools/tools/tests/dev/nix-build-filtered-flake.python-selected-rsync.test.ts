#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import {
  selectedPythonSnapshotRelPaths,
  selectedPythonSnapshotRsyncSources,
} from "../../dev/nix-build-filtered-flake-lib";
import { test } from "node:test";

test("selected python filtered-flake snapshots include importer uv lock", () => {
  const relPaths = selectedPythonSnapshotRelPaths("projects/apps/pytester");

  assert.ok(relPaths.includes("projects/apps/pytester"));
  assert.ok(relPaths.includes("build-tools"));
  assert.ok(relPaths.includes("viberoots"));
  assert.ok(!relPaths.includes("projects/apps/unrelated"));

  assert.deepEqual(selectedPythonSnapshotRsyncSources(relPaths).slice(0, 3), [
    "./.npmrc",
    "./flake.lock",
    "./flake.nix",
  ]);
});
