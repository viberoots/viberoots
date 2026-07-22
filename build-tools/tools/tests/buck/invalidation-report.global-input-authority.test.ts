#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeInvalidationRow } from "../../buck/invalidation-report-row";

const inputs = [
  "root//.viberoots/workspace:flake.nix",
  "root//.viberoots/workspace:flake.lock",
  "root//projects/config:node-modules.hashes.json",
  "workspace_buck//:graph.json",
  "viberoots//build-tools/tools/nix:nixpkgs_source_registry",
  "root//.viberoots/workspace:nixpkgs-source-registry-extension",
];

function row(labels = inputs, srcs = inputs) {
  return computeInvalidationRow(
    { name: "//app:x", labels: ["lang:rust", ...labels], srcs },
    {},
    {},
  );
}

test("global-input invalidation requires every configured authority", () => {
  assert.equal(row()?.global_nix_inputs_labels_stamped, true);
  assert.equal(row()?.global_nix_inputs_action_inputs_expected, true);
  for (const missing of inputs) {
    assert.equal(
      row(inputs.filter((label) => label !== missing))?.global_nix_inputs_labels_stamped,
      false,
    );
    assert.equal(
      row(
        inputs,
        inputs.filter((label) => label !== missing),
      )?.global_nix_inputs_action_inputs_expected,
      false,
    );
  }
});

test("global-input invalidation rejects legacy unqualified root labels", () => {
  const legacy = inputs.map((label) => label.replace(/^root/, ""));
  assert.equal(row(legacy, legacy)?.global_nix_inputs_labels_stamped, false);
  assert.equal(row(legacy, legacy)?.global_nix_inputs_action_inputs_expected, false);
});
