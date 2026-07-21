#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";

function graphNode(out: string): Record<string, unknown> {
  return {
    name: "workspace_buck//:graph.json",
    rule_type: "export_file",
    out,
    deps: [],
    labels: [],
  };
}

test("workspace graph serialization excludes its physical content-addressed output", () => {
  const cold = nodesFromCqueryJson({
    "workspace_buck//:graph.json": graphNode(`graph.${"a".repeat(64)}.json`),
  });
  const warm = nodesFromCqueryJson({
    "workspace_buck//:graph.json": graphNode(`graph.${"b".repeat(64)}.json`),
  });

  assert.equal(cold[0]?.name, "//:graph.json");
  assert.equal(cold[0]?.out, "graph.json");
  assert.deepEqual(warm, cold);
});

test("non-workspace graph outputs retain their physical identity", () => {
  const output = `graph.${"c".repeat(64)}.json`;
  const [node] = nodesFromCqueryJson({
    "root//projects/app:graph.json": graphNode(output),
  });
  assert.equal(node?.out, output);
});
