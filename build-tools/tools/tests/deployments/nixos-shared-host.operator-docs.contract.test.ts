#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const setupDocPath = path.join(repoRoot, "docs", "nixos-shared-host-setup.md");
const checklistDocPath = path.join(repoRoot, "docs", "nixos-shared-host-technician-checklist.md");

async function readDoc(filePath: string) {
  return await fsp.readFile(filePath, "utf8");
}

function assertServiceClientInstallParity(doc: string, label: string) {
  assert.match(doc, /client install \\/, `${label} must document client install`);
  assert.match(
    doc,
    /--control-plane-url http:\/\/127\.0\.0\.1:7780/,
    `${label} must require --control-plane-url`,
  );
  assert.match(
    doc,
    /--control-plane-token-env BNX_DEPLOY_CONTROL_PLANE_TOKEN/,
    `${label} must document the reviewed control-plane token env`,
  );
}

function assertApprovalGrantParity(doc: string, label: string) {
  assert.match(doc, /pending_approval/, `${label} must mention pending_approval`);
  assert.match(doc, /deploy_run_id/, `${label} must mention deploy_run_id`);
  assert.match(doc, /\/api\/v1\/run-actions/, `${label} must show the reviewed run-action path`);
  assert.match(
    doc,
    /"action": "approve"/,
    `${label} must document the reviewed approve run action`,
  );
  assert.match(
    doc,
    /expectedPayloadFingerprint/,
    `${label} must document payload fingerprint binding`,
  );
  assert.match(
    doc,
    /expectedProvisionerPlanFingerprint/,
    `${label} must document provisioner-plan fingerprint binding`,
  );
  assert.match(doc, /approval_no_longer_valid/, `${label} must mention stale approval rejection`);
  assert.match(
    doc,
    /unauthorized/,
    `${label} must mention unauthorized or self-approval rejection`,
  );
}

test("nixos shared host setup guide stays aligned with reviewed service-client and approval-grant workflows", async () => {
  const setupDoc = await readDoc(setupDocPath);
  assertServiceClientInstallParity(setupDoc, "setup guide");
  assertApprovalGrantParity(setupDoc, "setup guide");
});

test("nixos shared host technician checklist stays aligned with reviewed service-client and approval-grant workflows", async () => {
  const checklistDoc = await readDoc(checklistDocPath);
  assertServiceClientInstallParity(checklistDoc, "technician checklist");
  assertApprovalGrantParity(checklistDoc, "technician checklist");
});
