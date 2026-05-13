#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildVercelControlPlaneSnapshot } from "../../deployments/vercel-control-plane-snapshot";
import { executeKubernetesControlPlaneSubmission } from "../../deployments/kubernetes-control-plane";
import { executeS3StaticControlPlaneSubmission } from "../../deployments/s3-static-control-plane";
import {
  executeVercelControlPlaneSubmission,
  VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
} from "../../deployments/vercel-control-plane";
import { createFakeVercelApiClient } from "../../deployments/vercel-api";
import { runInTemp } from "../lib/test-helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";
import { vercelDeploymentFixture } from "./vercel.fixture";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  withVercelFixtureSecrets,
  withVercelSmokeServer,
  writeVercelArtifact,
  writeVercelPublisherConfig,
} from "./vercel.control-plane.helpers";
import {
  executeFrozenProviderSnapshot,
  fakeFrozenProviderSnapshot,
  frozenPolicy,
  vercelDeploymentWithSecrets,
} from "./provider-frozen-worker.helpers";

test("provider workers execute from frozen snapshot artifact and secret references", async () => {
  await runInTemp("provider-frozen-worker-executes", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    await writeVercelPublisherConfig(tmp);
    const vercel = vercelDeploymentWithSecrets();
    const apiClient = createFakeVercelApiClient();
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, vercel);
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
          await executeFrozenProviderSnapshot({
            tmp,
            recordsRoot,
            provider: "vercel",
            execute: executeVercelControlPlaneSubmission,
            snapshot,
            apiClient,
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
        executeFrozenProviderSnapshot({
          tmp,
          recordsRoot,
          provider: `${provider}-legacy`,
          execute,
          snapshot: fakeFrozenProviderSnapshot(deployment, provider, {
            frozenExecutionSchemaVersion: undefined,
          }),
        }),
        /requires frozen shared-admission snapshot/,
      );
      await assert.rejects(
        executeFrozenProviderSnapshot({
          tmp,
          recordsRoot,
          provider: `${provider}-mismatch`,
          execute,
          snapshot: fakeFrozenProviderSnapshot(deployment, provider, {
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
        executeFrozenProviderSnapshot({
          tmp,
          recordsRoot,
          provider: `${provider}-${suffix}`,
          execute,
          snapshot: fakeFrozenProviderSnapshot(deployment, provider),
          submissionAdmission,
        });
      await assert.rejects(
        rejectEnvelope("old-admission-envelope", { decision: "admitted", reason: "legacy" }),
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
        executeFrozenProviderSnapshot({
          tmp,
          recordsRoot,
          provider: `${provider}-replay`,
          execute,
          snapshot: fakeFrozenProviderSnapshot(deployment, provider, {
            sourceRecord: { deployRunId: "source-run" },
          }),
        }),
        /requires frozen replay snapshot/,
      );
    }
  });
});
