#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { listFreshnessOutputs } from "../../buck/prebuild/scan";

test("prebuild freshness excludes write-if-changed provider auto files", () => {
  assert.deepEqual(
    listFreshnessOutputs([
      ".viberoots/workspace/buck/graph.json",
      ".viberoots/workspace/providers/auto_map.bzl",
      ".viberoots/workspace/providers/TARGETS.node.auto",
      ".viberoots/workspace/providers/TARGETS.python.auto",
    ]),
    [".viberoots/workspace/buck/graph.json", ".viberoots/workspace/providers/auto_map.bzl"],
  );
});
