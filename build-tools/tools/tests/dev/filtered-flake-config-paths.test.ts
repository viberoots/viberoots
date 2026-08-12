#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FILTERED_FLAKE_CONFIG_PATHS,
  DEFAULT_FILTERED_FLAKE_ROOTS,
  defaultFilteredFlakeSnapshotRelPaths,
  relPathsForImmutableViberootsInput,
  relPathsWithoutNestedViberoots,
} from "../../dev/nix-build-filtered-flake-lib";

test("filtered snapshots include exact Buck config authority without broad config capture", () => {
  assert.deepEqual(DEFAULT_FILTERED_FLAKE_CONFIG_PATHS, [
    "config/.buckconfig",
    "config/rules.bzl",
    "config/prelude.bzl",
    "config/fbsource_stub",
    "config/fbcode_stub",
    "config/os",
    "config/cpu",
    "config/go/constraints",
  ]);
  assert.equal(DEFAULT_FILTERED_FLAKE_ROOTS.includes("config"), false);
  const paths = defaultFilteredFlakeSnapshotRelPaths();
  assert.equal(
    DEFAULT_FILTERED_FLAKE_CONFIG_PATHS.every((path) => paths.includes(path)),
    true,
  );
});

test("immutable viberoots authority removes the redundant nested tool source", () => {
  const paths = ["flake.nix", "viberoots", "viberoots/build-tools", "projects/apps/demo"];
  assert.deepEqual(relPathsForImmutableViberootsInput(paths, ""), paths);
  assert.deepEqual(relPathsForImmutableViberootsInput(paths, "/nix/store/source"), [
    "flake.nix",
    "projects/apps/demo",
  ]);
  assert.deepEqual(relPathsWithoutNestedViberoots(paths), ["flake.nix", "projects/apps/demo"]);
});
