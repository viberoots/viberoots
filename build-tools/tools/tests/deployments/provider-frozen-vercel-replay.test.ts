#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildVercelControlPlaneSnapshot } from "../../deployments/vercel-control-plane-snapshot";
import { createFakeVercelApiClient, type VercelApiClient } from "../../deployments/vercel-api";
import {
  executeVercelControlPlaneSubmission,
  VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
} from "../../deployments/vercel-control-plane";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";
import { vercelDeploymentFixture } from "./vercel.fixture";
import {
  deploymentWithVercelCleanupSecret,
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

async function executeSnapshot(opts: {
  tmp: string;
  recordsRoot: string;
  provider: string;
  snapshot: Record<string, any>;
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
    admission: opts.snapshot.admission,
  });
  await executeVercelControlPlaneSubmission({
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
  return JSON.parse(await fsp.readFile(submissionPath, "utf8"));
}

function vercelReplayDeployment() {
  const publish = deploymentWithVercelSecret();
  const cleanup = deploymentWithVercelCleanupSecret();
  return vercelDeploymentFixture({
    secretRequirements: [...publish.secretRequirements, ...cleanup.secretRequirements],
    admissionPolicy: {
      ...publish.admissionPolicy,
      allowedRefs: ["main"],
      requiredChecks: [],
    },
  });
}

test("vercel worker retry rollback and preview cleanup replay frozen snapshots", async () => {
  await runInTemp("provider-frozen-vercel-replay", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const deployment = vercelReplayDeployment();
    const apiClient = createFakeVercelApiClient();
    await writeVercelPublisherConfig(tmp);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await withVercelFixtureSecrets(
      {
        "vercel/api-token": {
          value: "token",
          allowedSteps: ["publish", "smoke", "preview_cleanup"],
          targetScopes: ["*"],
        },
      },
      async () =>
        await withVercelSmokeServer(async (smokeConnectOverride) => {
          const artifactDir = await writeVercelArtifact(path.join(tmp, "vercel-artifact"));
          const deploy = await buildVercelControlPlaneSnapshot({
            workspaceRoot: tmp,
            recordsRoot,
            request: {
              schemaVersion: VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
              submissionId: "vercel-replay-source",
              submittedAt: new Date().toISOString(),
              deployment,
              operationKind: "deploy",
              artifactDir,
              admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
              smokeConnectOverride,
            },
          });
          await fsp.rm(artifactDir, { recursive: true, force: true });
          const source = await executeSnapshot({
            tmp,
            recordsRoot,
            provider: "vercel-source",
            snapshot: deploy,
            apiClient,
          });
          assert.equal(source.finalOutcome, "succeeded");
          for (const operationKind of [
            "preview",
            "retry",
            "rollback",
            "preview_cleanup",
          ] as const) {
            const snapshot = await buildVercelControlPlaneSnapshot({
              workspaceRoot: tmp,
              recordsRoot,
              request: {
                schemaVersion: VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
                submissionId: `vercel-${operationKind}`,
                submittedAt: new Date().toISOString(),
                deployment,
                operationKind,
                sourceRunId: source.deployRunId,
                admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
                smokeConnectOverride,
              },
            });
            const result = await executeSnapshot({
              tmp,
              recordsRoot,
              provider: `vercel-${operationKind}`,
              snapshot,
              apiClient,
            });
            assert.equal(result.finalOutcome, "succeeded");
          }
        }),
    );
  });
});
