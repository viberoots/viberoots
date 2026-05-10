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
    /--control-plane-url https:\/\/deploy\.apps\.kilty\.io/,
    `${label} must require --control-plane-url`,
  );
  assert.match(
    doc,
    /--control-plane-token-env VBR_DEPLOY_CONTROL_PLANE_TOKEN/,
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
    /authenticated service session/,
    `${label} must document service-derived reviewer identity for approvals`,
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
    /start-here entrypoint for first-time `mini` setup/i,
    "usage guide must declare itself as the mini setup entrypoint",
  );
  assert.match(
    usageDoc,
    /Start Here For `mini` Setup/,
    "usage guide must include a dedicated mini setup entrypoint section",
  );
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
  assert.match(
    usageDoc,
    /Vault Production Bootstrap Runbook/,
    "usage guide must point operators at the Vault bootstrap runbook when mini deploys need secrets",
  );
  assert.match(
    usageDoc,
    /shared-host-postgres-module\.nix/,
    "usage guide must point operators at the reviewed importable Postgres module",
  );
  assert.match(
    usageDoc,
    /shared-host-identity-provider-module\.nix/,
    "usage guide must point operators at the reviewed importable identity-provider module",
  );
  assert.match(
    usageDoc,
    /deploy-vault-jwt/,
    "usage guide must mention the reviewed workload-JWT helper",
  );
  assert.match(
    setupDoc,
    /shared-host-identity-provider-module\.nix/,
    "setup guide must document the reviewed importable identity-provider module",
  );
  assert.match(
    setupDoc,
    /deploy-vault-jwt/,
    "setup guide must mention the reviewed workload-JWT helper",
  );
  assert.match(
    setupDoc,
    /shared-host-postgres-module\.nix/,
    "setup guide must document the reviewed importable Postgres module",
  );
  assert.match(
    setupDoc,
    /shared-host-vault-module\.nix/,
    "setup guide must document the reviewed importable Vault module",
  );
  assert.match(
    setupDoc,
    /inputs\.deploymentModules = \{[\s\S]*url = "path:\/srv\/viberoots\/build-tools\/tools\/nix";[\s\S]*flake = false;/,
    "setup guide must document narrow non-flake path input wiring for repo-hosted service modules",
  );
  assert.match(
    setupDoc,
    /deploymentModulesRoot = deploymentModules/,
    "setup guide must pass the service-module flake input into configuration.nix",
  );
  assert.match(
    setupDoc,
    /\$\{deploymentModulesRoot\}\/shared-host-vault-module\.nix/,
    "setup guide must import service modules through the flake input, not an absolute path",
  );
  assert.match(setupDoc, /\$\{deploymentModulesRoot\}\/nixos-shared-host-module\.nix/);
  assert.match(
    usageDoc,
    /Avoid pointing the input at\s+all of `\/srv\/viberoots`, since that copies the full repo into the store/,
    "usage guide must avoid full-repo path inputs for service modules",
  );
  assert.match(
    usageDoc,
    /pure flake evaluation\s+rejects absolute paths/,
    "usage guide must warn against direct absolute module imports under flakes",
  );
  assert.match(usageDoc, /Deployment Contract/, "usage guide must link to the deployment contract");
  assert.match(
    usageDoc,
    /nixos-shared-host-jenkins-deploy/,
    "usage guide must show the reviewed Jenkins entrypoint",
  );
  assert.match(
    setupDoc,
    /first documentation entrypoint for setting up\s+`mini`[\s\S]*NixOS Shared Host Usage/,
    "setup guide must point operators at the usage front door as the mini setup entrypoint",
  );
  assert.match(
    setupDoc,
    /Vault Production Bootstrap Runbook/,
    "setup guide must point operators at the canonical Vault bootstrap runbook",
  );
  assert.doesNotMatch(
    usageDoc,
    /AppRole/,
    "usage guide must not present AppRole as the normal mini credential path",
  );
  assert.doesNotMatch(
    setupDoc,
    /AppRole/,
    "setup guide must not present AppRole as the normal mini credential path",
  );
  for (const fragment of [
    /managed-manual-wire/,
    /managed-dropin/,
    /emit-only/,
    /managed = true/,
    /wiringState = wired/,
    /wiringState = missing/,
  ]) {
    assert.match(
      setupDoc,
      fragment,
      `setup guide must explain reviewed install-mode or status detail ${String(fragment)}`,
    );
  }
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
