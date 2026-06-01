#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import {
  hookEvidenceRefs,
  providerCapabilityHookEvidenceRecord,
} from "../../deployments/cloud-control-provider-capability-hook-contract";
import { validateProviderCapabilityEvidence } from "../../deployments/cloud-control-provider-capability-readiness";
import type { ProviderCapabilityDeclaration } from "../../deployments/cloud-control-setup-types";

export async function validateAwsProviderCapabilityEvidence(
  env: Record<string, string>,
  declarations: ProviderCapabilityDeclaration[],
  evidenceByCapability: Record<string, unknown>,
) {
  if (env.VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY !== "1") return;
  const awsTopology = await readJsonFile(env.VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY_EVIDENCE_FILE);
  const driftErrors = validateProviderCapabilityEvidence(declarations, evidenceByCapability, {
    awsTopology,
  });
  assert.deepEqual(driftErrors, [], driftErrors.join("; "));
  const selected = declarations.find(
    (capability) =>
      capability.id ===
      (env.VBR_CONTROL_PLANE_LIVE_AWS_PROVIDER_CAPABILITY_ID || "aws-ec2-control-plane-host"),
  );
  assert.ok(selected, "selected AWS provider capability is required for topology evidence");
  const selectedEvidence = evidenceByCapability[selected.id];
  const selectedRecord = providerCapabilityHookEvidenceRecord(selectedEvidence);
  const attached = new Set(
    selectedRecord
      ? hookEvidenceRefs(selectedRecord)
      : Array.isArray(selectedEvidence)
        ? selectedEvidence.map(String)
        : [],
  );
  for (const file of [
    env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE,
    env.VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE,
    env.VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE,
  ]) {
    const refs = await evidenceRefs(file);
    assert.ok(
      refs.some((ref) => attached.has(ref)),
      `${selected.id} evidence must reference ${path.basename(file)} by file or digest`,
    );
  }
}

async function evidenceRefs(file: string) {
  const digest = createHash("sha256")
    .update(await fsp.readFile(file))
    .digest("hex");
  return [file, `file:${file}`, `sha256:${digest}`, `${path.basename(file)}:sha256:${digest}`];
}

async function readJsonFile(file: string) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}
