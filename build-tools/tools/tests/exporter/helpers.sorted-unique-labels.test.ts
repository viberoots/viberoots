#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";

test("sortedUniqueLabels dedupes labels and sorts nodes by name", async () => {
  const { sortedUniqueLabels } = await import("../../buck/exporter/lang/helpers");
  const nodes = [
    { name: "//b:bin", rule_type: "go_binary", labels: ["x", "a", "x"] },
    { name: "//a:lib", rule_type: "go_library", labels: ["b", "a", "b"] },
  ];
  const out = sortedUniqueLabels(nodes as any);
  assert.equal(out[0].name, "//a:lib");
  assert.deepEqual(out[0].labels, ["a", "b"]);
  assert.equal(out[1].name, "//b:bin");
  assert.deepEqual(out[1].labels, ["a", "x"]);
});
