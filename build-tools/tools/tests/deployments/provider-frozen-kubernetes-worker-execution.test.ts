#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildKubernetesControlPlaneSnapshot } from "../../deployments/kubernetes-control-plane-snapshot";
import {
  executeKubernetesControlPlaneSubmission,
  KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
} from "../../deployments/kubernetes-control-plane";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { installFakeKubernetesHelm } from "./kubernetes.fake-helm";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { startKubernetesPublicServer } from "./kubernetes.public-server";
import {
  reviewedKubernetesPublishRequirements,
  writeKubernetesPublishSecretFixture,
} from "./kubernetes.publish-credentials.fixture";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import { withEnvOverrides } from "./nixos-shared-host.control-plane.helpers";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";

async function writeJson(filePath: string, value: Record<string, unknown>) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function executeSnapshot(opts: {
  tmp: string;
  recordsRoot: string;
  provider: string;
  snapshot: Record<string, any>;
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
  await executeKubernetesControlPlaneSubmission({
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
  return JSON.parse(await fsp.readFile(submissionPath, "utf8"));
}

async function writeValues(tmp: string, deploymentId: string) {
  const configPath = path.join(tmp, "projects", "deployments", deploymentId, "helm", "values.yaml");
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(
    configPath,
    "chart: ./charts/api\nsmoke_url: http://shared-observability.example.test/healthz\nsmoke_expect_contains: api\n",
    "utf8",
  );
}

test("kubernetes worker deploy and retry execute from frozen snapshots", async () => {
  await runInTemp("provider-frozen-kubernetes-worker-execution", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const deployment = kubernetesDeploymentFixture({
      secretRequirements: reviewedKubernetesPublishRequirements(),
      vaultRuntime: {
        addr: "https://vault.fixture.local:8200",
        oidcIssuer: "https://vault.fixture.local",
      },
    });
    const fake = await installFakeKubernetesHelm(tmp);
    const secretFixturePath = await writeKubernetesPublishSecretFixture(tmp);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    await writeValues(tmp, deployment.deploymentId);
    const server = await startKubernetesPublicServer({ deployment, publishRoot: fake.publishRoot });
    const smokeConnectOverride = {
      protocol: "http:" as const,
      hostname: "127.0.0.1",
      port: server.port,
    };
    try {
      await withEnvOverrides(
        {
          PATH: `${fake.binDir}:${process.env.PATH || ""}`,
          VBR_KUBERNETES_HELM_BIN: path.join(fake.binDir, "helm"),
          VBR_KUBERNETES_FAKE_PUBLISH_ROOT: fake.publishRoot,
          VBR_KUBERNETES_FAKE_HELM_LOG: fake.logPath,
          [DEPLOYMENT_SECRET_FIXTURE_PATH_ENV]: secretFixturePath,
        },
        async () => {
          const artifactDir = path.join(tmp, "kube-artifact");
          await writeServiceArtifact(artifactDir, "api\n");
          const deploy = await buildKubernetesControlPlaneSnapshot({
            workspaceRoot: tmp,
            recordsRoot,
            request: {
              schemaVersion: KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
              submissionId: "kube-worker-deploy",
              submittedAt: new Date().toISOString(),
              deployment,
              operationKind: "deploy",
              artifactDir,
              admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
              smokeConnectOverride,
            },
          });
          await fsp.rm(artifactDir, { recursive: true, force: true });
          const deployed = await executeSnapshot({
            tmp,
            recordsRoot,
            provider: "kube-deploy",
            snapshot: deploy,
          });
          assert.equal(deployed.finalOutcome, "succeeded");
          const retry = await buildKubernetesControlPlaneSnapshot({
            workspaceRoot: tmp,
            recordsRoot,
            request: {
              schemaVersion: KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
              submissionId: "kube-worker-retry",
              submittedAt: new Date().toISOString(),
              deployment,
              operationKind: "retry",
              sourceRunId: deployed.deployRunId,
              admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
              smokeConnectOverride,
            },
          });
          const replayed = await executeSnapshot({
            tmp,
            recordsRoot,
            provider: "kube-retry",
            snapshot: retry,
          });
          assert.equal(replayed.finalOutcome, "succeeded");
        },
      );
    } finally {
      await server.close();
    }
  });
});
