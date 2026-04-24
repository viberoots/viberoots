#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

async function read(rel: string) {
  return await fsp.readFile(path.join(repoRoot, rel), "utf8");
}

test("pr91 docs keep admission_reporter as the submit-time evidence boundary", async () => {
  const [usageDoc, sharedHostUsageDoc, scenariosDoc, contractDoc, setupDoc, checklistDoc] =
    await Promise.all([
      read("docs/deployments-usage.md"),
      read("docs/nixos-shared-host-usage.md"),
      read("docs/deployment-scenarios.md"),
      read("docs/deployments-contract.md"),
      read("docs/nixos-shared-host-setup.md"),
      read("docs/nixos-shared-host-technician-checklist.md"),
    ]);
  for (const doc of [usageDoc, sharedHostUsageDoc, setupDoc, checklistDoc]) {
    assert.match(doc, /mark-check-passed[\s\S]*authorized shortcut/i);
    assert.match(doc, /submitter[\s\S]*admission_reporter/i);
  }
  assert.match(scenariosDoc, /human manual check reporting[\s\S]*admission_reporter/i);
  assert.match(scenariosDoc, /CI structured evidence[\s\S]*submitter[\s\S]*admission_reporter/i);
  assert.match(contractDoc, /submit-time `admissionEvidence\.checks`[\s\S]*admission_reporter/i);
  assert.match(contractDoc, /mark-check-passed[\s\S]*same `admission_reporter` authorization/i);
});
