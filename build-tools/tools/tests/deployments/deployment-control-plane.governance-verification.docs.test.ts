#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function read(rel: string) {
  return await fsp.readFile(path.join(process.cwd(), rel), "utf8");
}

test("deployment control plane docs keep service-owned governance verification aligned", async () => {
  const [designDoc, usageDoc, sharedHostUsageDoc, setupDoc] = await Promise.all([
    read("docs/history/designs/deployments-design.md"),
    read("docs/deployments-usage.md"),
    read("docs/nixos-shared-host-usage.md"),
    read("docs/nixos-shared-host-setup.md"),
  ]);
  assert.match(
    designDoc,
    /for supported SCM backends[\s\S]*shared control-plane service should verify/i,
  );
  assert.match(
    designDoc,
    /persist whether the admitted\s+fact was `service_verified` or `client_supplied`/i,
  );
  for (const doc of [usageDoc, sharedHostUsageDoc]) {
    assert.match(doc, /service-owned lane governance\s+verification/i);
    assert.match(doc, /VBR_DEPLOY_GITHUB_TOKEN/);
    assert.match(doc, /unsupported SCM backends?[\s\S]*--admission-evidence-json/i);
    assert.match(doc, /client-supplied `laneGovernance` JSON|hand-build `laneGovernance` JSON/i);
    assert.match(doc, /does not\s+need|do not\s+hand-build/i);
  }
  assert.match(setupDoc, /VBR_DEPLOY_GITHUB_TOKEN/);
  assert.match(
    setupDoc,
    /verify GitHub-backed lane governance\s+automatically[\s\S]*protected\/shared admission/i,
  );
});
