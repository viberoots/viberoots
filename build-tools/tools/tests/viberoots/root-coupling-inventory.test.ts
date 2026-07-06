#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectInventory } from "../../dev/viberoots-root-coupling-inventory";

test("viberoots root-coupling inventory reports baseline counts without failing", async () => {
  const findings = await collectInventory(process.cwd(), 2);
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  for (const id of [
    "buck_build_tools_label",
    "workspace_root_build_tools_path",
    "flk_root_build_tools_path",
    "third_party_providers_label",
    "third_party_providers_path",
  ]) {
    const finding = byId.get(id);
    assert.ok(finding, `missing inventory bucket ${id}`);
    assert.ok(Number.isInteger(finding.count), `${id} count must be an integer`);
    assert.ok(finding.count >= 0, `${id} count must not be negative`);
    assert.ok(finding.examples.length <= 2, `${id} must respect the example limit`);
  }
  assert.ok(
    findings.every((finding) => Number.isInteger(finding.count)),
    "expected inventory to complete even when no root-coupled references remain",
  );
});
