#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEPLOYMENT_PROVIDER_FROZEN_SNAPSHOT_SCHEMA } from "../../deployments/deployment-provider-frozen-snapshot";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import type { VercelApiClient } from "../../deployments/vercel-api";
import { deploymentWithVercelSecret } from "./vercel.control-plane.helpers";
import { vercelDeploymentFixture } from "./vercel.fixture";

const defaultAdmission = { decision: "admitted", reason: "legacy" };

async function writeJson(filePath: string, value: Record<string, unknown>) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function executeFrozenProviderSnapshot(opts: {
  tmp: string;
  recordsRoot: string;
  provider: string;
  execute: (opts: any) => Promise<unknown>;
  snapshot: Record<string, any>;
  submissionAdmission?: unknown;
  apiClient?: VercelApiClient;
}) {
  const submissionPath = path.join(opts.recordsRoot, `${opts.provider}-submission.json`);
  const snapshotPath = path.join(opts.recordsRoot, `${opts.provider}-snapshot.json`);
  await writeJson(snapshotPath, opts.snapshot);
  await writeJson(submissionPath, {
    schemaVersion: "deployment-provider-control-plane-submission@1",
    submissionId: opts.snapshot.submissionId,
    submittedAt: opts.snapshot.submittedAt,
    operationKind: opts.snapshot.operationKind,
    deploymentId: opts.snapshot.deploymentId,
    deploymentLabel: opts.snapshot.deploymentLabel,
    providerTargetIdentity: opts.snapshot.providerTargetIdentity,
    lockScope: opts.snapshot.lockScope,
    executionSnapshotPath: snapshotPath,
    lifecycleState: "queued",
    terminationReason: null,
    dedupe: { mode: "created", requestFingerprint: opts.provider },
    admission: opts.submissionAdmission ?? opts.snapshot.admission ?? defaultAdmission,
  });
  return await opts.execute({
    workspaceRoot: opts.tmp,
    recordsRoot: opts.recordsRoot,
    backend: {
      recordsRoot: opts.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(opts.recordsRoot),
    },
    submissionPath,
    submissionRef: submissionPath,
    executionSnapshotPath: snapshotPath,
    executionSnapshotRef: snapshotPath,
    workerId: `${opts.provider}-worker`,
    ...(opts.apiClient ? { apiClient: opts.apiClient } : {}),
  });
}

export function frozenPolicy(fingerprint: string) {
  return { binding: { payloadFingerprint: fingerprint } };
}

export function fakeFrozenProviderSnapshot(
  deployment: any,
  provider: string,
  patch: Record<string, unknown> = {},
) {
  const fp = "sha256:frozen";
  return {
    schemaVersion: `${provider}-control-plane-snapshot@1`,
    frozenExecutionSchemaVersion: DEPLOYMENT_PROVIDER_FROZEN_SNAPSHOT_SCHEMA,
    submissionId: `${provider}-snapshot`,
    submittedAt: "2026-05-06T12:00:00.000Z",
    operationKind: "retry",
    deploymentId: deployment.deploymentId,
    deploymentLabel: deployment.label,
    providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
    lockScope: deployment.providerTarget.providerTargetIdentity,
    deployment,
    workspaceRoot: "",
    recordsRoot: "",
    parentRunId: "source-run",
    releaseLineageId: "release-lineage",
    artifactLineageId: "artifact-lineage",
    admittedContext: { policyEvaluation: frozenPolicy(fp) },
    admission: {
      decision: "admitted",
      reason: "shared_nonprod",
      policyEvaluation: frozenPolicy(fp),
    },
    ...patch,
  };
}

export function vercelDeploymentWithSecrets() {
  const secretful = deploymentWithVercelSecret();
  return vercelDeploymentFixture({
    secretRequirements: secretful.secretRequirements,
    admissionPolicy: {
      ...secretful.admissionPolicy,
      allowedRefs: ["env/pleomino/staging"],
      requiredChecks: [],
    },
  });
}
