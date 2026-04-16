#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const usageDocPath = path.join(repoRoot, "docs", "nixos-shared-host-usage.md");
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
  assert.match(doc, /--status/, `${label} must document the reviewed status helper`);
  assert.match(doc, /--approve/, `${label} must document the reviewed approve helper`);
  assert.match(doc, /--approval-id/, `${label} must document approval references`);
  assert.match(
    doc,
    /--requested-by-principal/,
    `${label} must document reviewer identity for approvals`,
  );
  assert.match(doc, /payloadFingerprint/, `${label} must document payload fingerprint binding`);
  assert.match(
    doc,
    /provisionerPlanFingerprint/,
    `${label} must document provisioner-plan fingerprint binding`,
  );
  assert.match(doc, /approval_no_longer_valid/, `${label} must mention stale approval rejection`);
  assert.match(
    doc,
    /unauthorized/,
    `${label} must mention unauthorized or self-approval rejection`,
  );
  assert.ok(!doc.includes("/api/v1/run-actions"), `${label} must not require raw run-action HTTP`);
  assert.ok(!doc.includes("curl -fsS"), `${label} must not require raw curl commands`);
}

function assertServiceOnlyRemoteGuardrails(doc: string, label: string) {
  assert.match(
    doc,
    /(?:do not accept|Do not pass) `--control-plane-url`,\s*`--apply-host`, or `--apply-host-dry-run`/,
    `${label} must keep the reviewed service-only remote-profile guardrails`,
  );
  assert.ok(
    !doc.includes("--remote-config-root"),
    `${label} must not reintroduce remote host-apply overrides`,
  );
  assert.ok(
    !doc.includes("--remote-managed-root"),
    `${label} must not reintroduce remote managed-root overrides`,
  );
}

function assertBackendNativeInspectionParity(doc: string, label: string) {
  assert.match(doc, /submissionId/, `${label} must mention submissionId`);
  assert.match(
    doc,
    /deployRunId|deploy_run_id/,
    `${label} must mention deployRunId or deploy_run_id`,
  );
  assert.match(doc, /--status/, `${label} must show the reviewed status helper`);
  assert.ok(!doc.includes("recordPath"), `${label} must not document stale recordPath inspection`);
  assert.ok(
    !doc.includes("resultRecordPath"),
    `${label} must not document stale resultRecordPath inspection`,
  );
  assert.ok(
    !doc.includes("submissionPath"),
    `${label} must not document stale submissionPath inspection`,
  );
}

test("nixos shared host usage guide stays present as the reviewed operator-facing front door", async () => {
  const [usageDoc, setupDoc, checklistDoc] = await Promise.all([
    readDoc(usageDocPath),
    readDoc(setupDocPath),
    readDoc(checklistDocPath),
  ]);
  assert.match(
    usageDoc,
    /NixOS Shared Host Setup/,
    "usage guide must link back to the setup reference",
  );
  assert.match(
    usageDoc,
    /NixOS Shared Host Technician Checklist/,
    "usage guide must link to the technician checklist",
  );
  assert.match(
    usageDoc,
    /Mini Shared-Dev Deployment Design/,
    "usage guide must link to the design doc",
  );
  assert.match(usageDoc, /Deployment Contract/, "usage guide must link to the deployment contract");
  assert.match(
    usageDoc,
    /nixos-shared-host-jenkins-deploy/,
    "usage guide must show the reviewed Jenkins entrypoint",
  );
  assert.match(
    setupDoc,
    /NixOS Shared Host Usage/,
    "setup guide must point operators at the usage front door",
  );
  assert.match(
    checklistDoc,
    /NixOS Shared Host Usage/,
    "technician checklist must point back to the usage front door",
  );
});

test("nixos shared host usage, setup, and checklist docs stay aligned with reviewed service-client and approval-grant workflows", async () => {
  const docs = [
    ["usage guide", await readDoc(usageDocPath)],
    ["setup guide", await readDoc(setupDocPath)],
    ["technician checklist", await readDoc(checklistDocPath)],
  ] as const;
  for (const [label, doc] of docs) {
    assertServiceClientInstallParity(doc, label);
    assertApprovalGrantParity(doc, label);
    assertServiceOnlyRemoteGuardrails(doc, label);
    assertBackendNativeInspectionParity(doc, label);
  }
});
