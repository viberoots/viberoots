#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsRepoPath } from "./deployment-command";

async function read(rel: string) {
  return await fsp.readFile(viberootsRepoPath(rel), "utf8");
}

test("deployment control plane docs keep admission requirement discovery aligned with the CLI", async () => {
  const [usageDoc, sharedHostUsageDoc, setupDoc, contractDoc] = await Promise.all([
    read("docs/deployments-usage.md"),
    read("docs/nixos-shared-host-usage.md"),
    read("docs/nixos-shared-host-setup.md"),
    read("docs/deployments-contract.md"),
  ]);
  for (const doc of [usageDoc, sharedHostUsageDoc, setupDoc]) {
    assert.match(doc, /validate-only[\s\S]*required_checks/i);
    assert.match(doc, /admit-and-deploy[\s\S]*admission_reporter/i);
  }
  assert.match(
    contractDoc,
    /validate-only[\s\S]*admission_policy[\s\S]*allowed_refs[\s\S]*required_checks[\s\S]*required_approvals/i,
  );
  assert.match(contractDoc, /discovering required check names[\s\S]*admission_reporter/i);
});
