#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_PROVIDER_FROZEN_SNAPSHOT_SCHEMA } from "../../deployments/deployment-provider-frozen-snapshot";
import { buildVercelControlPlaneSnapshot } from "../../deployments/vercel-control-plane-snapshot";
import { executeKubernetesControlPlaneSubmission } from "../../deployments/kubernetes-control-plane";
import { executeS3StaticControlPlaneSubmission } from "../../deployments/s3-static-control-plane";
import {
  executeVercelControlPlaneSubmission,
  VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
} from "../../deployments/vercel-control-plane";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";
import { vercelDeploymentFixture } from "./vercel.fixture";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  deploymentWithVercelSecret,
  withVercelFixtureSecrets,
  withVercelSmokeServer,
  writeVercelArtifact,
  writeVercelPublisherConfig,
} from "./vercel.control-plane.helpers";

async function writeJson(filePath: string, value: Record<string, unknown>) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const legacyAdmission = { decision: "admitted", reason: "legacy" };

async function executeSnapshot(opts: {
  tmp: string;
  recordsRoot: string;
  provider: string;
  execute: (opts: any) => Promise<unknown>;
  snapshot: Record<string, any>;
  submissionAdmission?: unknown;
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
    admission: opts.submissionAdmission ?? opts.snapshot.admission ?? legacyAdmission,
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
  });
}

function frozenPolicy(fingerprint: string) {
  return { binding: { payloadFingerprint: fingerprint } };
}

function fakeSnapshot(deployment: any, provider: string, patch: Record<string, unknown> = {}) {
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

function vercelWithSecrets() {
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

test("provider workers execute from frozen snapshot artifact and secret references", async () => {
  await runInTemp("provider-frozen-worker-executes", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    await writeVercelPublisherConfig(tmp);
    const vercel = vercelWithSecrets();
    await ensureNixosSharedHostStageBranch(tmp, $, vercel);
    await withVercelFixtureSecrets(
      {
        "vercel/api-token": {
          value: "token",
          allowedSteps: ["publish", "smoke"],
          targetScopes: ["*"],
        },
      },
      async () =>
        await withVercelSmokeServer(async (smokeConnectOverride) => {
          const artifactDir = await writeVercelArtifact(path.join(tmp, "vercel-worker-artifact"));
          const snapshot = await buildVercelControlPlaneSnapshot({
            workspaceRoot: tmp,
            recordsRoot,
            request: {
              schemaVersion: VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
              submissionId: "vercel-worker",
              submittedAt: new Date().toISOString(),
              deployment: vercel,
              operationKind: "deploy",
              artifactDir,
              admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment: vercel }),
              smokeConnectOverride,
            },
          });
          await fsp.rm(artifactDir, { recursive: true, force: true });
          await executeSnapshot({
            tmp,
            recordsRoot,
            provider: "vercel",
            execute: executeVercelControlPlaneSubmission,
            snapshot,
          });
        }),
    );
  });
});

test("provider workers reject non-shared and mismatched admission snapshots", async () => {
  await runInTemp("provider-frozen-worker-rejects", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const cases = [
      ["vercel", executeVercelControlPlaneSubmission, vercelDeploymentFixture()],
      ["s3-static", executeS3StaticControlPlaneSubmission, s3StaticDeploymentFixture()],
      ["kubernetes", executeKubernetesControlPlaneSubmission, kubernetesDeploymentFixture()],
    ] as const;
    for (const [provider, execute, deployment] of cases) {
      await assert.rejects(
        executeSnapshot({
          tmp,
          recordsRoot,
          provider: `${provider}-legacy`,
          execute,
          snapshot: fakeSnapshot(deployment, provider, { frozenExecutionSchemaVersion: undefined }),
        }),
        /requires frozen shared-admission snapshot/,
      );
      await assert.rejects(
        executeSnapshot({
          tmp,
          recordsRoot,
          provider: `${provider}-mismatch`,
          execute,
          snapshot: fakeSnapshot(deployment, provider, {
            admittedContext: { policyEvaluation: frozenPolicy("sha256:context") },
            admission: {
              decision: "admitted",
              reason: "shared_nonprod",
              policyEvaluation: frozenPolicy("sha256:admission"),
            },
          }),
        }),
        /mismatched shared admission evidence/,
      );
      const rejectEnvelope = (suffix: string, submissionAdmission: unknown) =>
        executeSnapshot({
          tmp,
          recordsRoot,
          provider: `${provider}-${suffix}`,
          execute,
          snapshot: fakeSnapshot(deployment, provider),
          submissionAdmission,
        });
      await assert.rejects(
        rejectEnvelope("legacy-envelope", { decision: "admitted", reason: "legacy" }),
        /shared submission admission/,
      );
      await assert.rejects(
        rejectEnvelope("stale-envelope", {
          decision: "admitted",
          reason: "shared_nonprod",
          policyEvaluation: { ...frozenPolicy("sha256:frozen"), evaluatedAt: "stale" },
        }),
        /stale submission admission policy/,
      );
    }
  });
});

test("provider replay workers require admitted recorded replay snapshots", async () => {
  await runInTemp("provider-frozen-worker-replay", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const cases = [
      ["vercel", executeVercelControlPlaneSubmission, vercelDeploymentFixture()],
      ["s3-static", executeS3StaticControlPlaneSubmission, s3StaticDeploymentFixture()],
      ["kubernetes", executeKubernetesControlPlaneSubmission, kubernetesDeploymentFixture()],
    ] as const;
    for (const [provider, execute, deployment] of cases) {
      await assert.rejects(
        executeSnapshot({
          tmp,
          recordsRoot,
          provider: `${provider}-replay`,
          execute,
          snapshot: fakeSnapshot(deployment, provider, {
            sourceRecord: { deployRunId: "source-run" },
          }),
        }),
        /requires frozen replay snapshot/,
      );
    }
  });
});
