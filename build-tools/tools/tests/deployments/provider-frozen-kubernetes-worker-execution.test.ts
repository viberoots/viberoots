#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildKubernetesControlPlaneSnapshot } from "../../deployments/kubernetes-control-plane-snapshot";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import {
  executeKubernetesControlPlaneSubmission,
  KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
} from "../../deployments/kubernetes-control-plane";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  infisicalRuntime,
  infisicalSecret,
  infisicalTestContext,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { installFakeKubernetesHelm } from "./kubernetes.fake-helm";
import { kubernetesDeploymentFixture, writeKubernetesLiveStateFixture } from "./kubernetes.fixture";
import { startKubernetesPublicServer } from "./kubernetes.public-server";
import { reviewedKubernetesPublishRequirements } from "./kubernetes.publish-credentials.fixture";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import { withEnvOverrides } from "./nixos-shared-host.control-plane.helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { executeFrozenProviderSnapshotAndReadSubmission } from "./provider-frozen-worker.helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";

const infisicalClientSecret = "server-local-secret";

async function writeValues(tmp: string, deploymentId: string) {
  const configPath = path.join(tmp, "projects", "deployments", deploymentId, "helm", "values.yaml");
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(
    configPath,
    "chart: ./charts/api\nsmoke_url: http://shared-observability.example.test/healthz\nsmoke_expect_contains: api\n",
    "utf8",
  );
}

async function buildSnapshotWithInfisicalAdmission(
  siteUrl: string,
  opts: Parameters<typeof buildKubernetesControlPlaneSnapshot>[0],
) {
  const restore = activateDeploymentSecretContext(
    infisicalTestContext(siteUrl, { clientSecret: infisicalClientSecret }),
  );
  try {
    return await buildKubernetesControlPlaneSnapshot(opts);
  } finally {
    restore();
  }
}

test("kubernetes worker deploy and retry execute from frozen snapshots", async () => {
  await runInTemp("provider-frozen-kubernetes-worker-execution", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const infisical = await startFakeInfisicalServer(
      [
        { clientId: "id", clientSecret: infisicalClientSecret, accessToken: "admission-token" },
        { clientId: "kube-worker", clientSecret: infisicalClientSecret, accessToken: "token" },
      ],
      [
        infisicalSecret({
          secretName: "publish-kubeconfig",
          secretValue: "vault-fake-kubeconfig",
        }),
      ],
    );
    const deployment = {
      ...kubernetesDeploymentFixture({
        secretRequirements: reviewedKubernetesPublishRequirements(),
      }),
      secretBackend: "infisical" as const,
      infisicalRuntime: {
        ...infisicalRuntime,
        siteUrl: infisical.siteUrl,
        preferredCredentialSource: "machine_identity_universal_auth" as const,
        machineIdentityClientIdEnv: "VBR_KUBE_INFISICAL_CLIENT_ID",
        machineIdentityClientSecretEnv: "VBR_KUBE_INFISICAL_CLIENT_SECRET",
      },
    };
    const fake = await installFakeKubernetesHelm(tmp);
    const liveStatePath = await writeKubernetesLiveStateFixture(tmp, deployment);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
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
          VBR_KUBERNETES_LIVE_STATE_PATH: liveStatePath,
          VBR_KUBE_INFISICAL_CLIENT_ID: "kube-worker",
          VBR_KUBE_INFISICAL_CLIENT_SECRET: infisicalClientSecret,
        },
        async () => {
          const objectStore = memoryControlPlaneArtifactStore();
          const artifactDir = path.join(tmp, "kube-artifact");
          await writeServiceArtifact(artifactDir, "api\n");
          const deploy = await buildSnapshotWithInfisicalAdmission(infisical.siteUrl, {
            workspaceRoot: tmp,
            recordsRoot,
            objectStore,
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
          assert.match(deploy.preparedPublisherConfig?.fingerprint || "", /^sha256:/);
          await fsp.writeFile(
            path.join(
              tmp,
              "projects",
              "deployments",
              deployment.deploymentId,
              "helm",
              "values.yaml",
            ),
            "chart: ./charts/api\ncluster: drifted-cluster\n",
            "utf8",
          );
          await fsp.rm(artifactDir, { recursive: true, force: true });
          const deployed = await executeFrozenProviderSnapshotAndReadSubmission({
            tmp,
            recordsRoot,
            provider: "kube-deploy",
            execute: executeKubernetesControlPlaneSubmission,
            snapshot: deploy,
            objectStore,
          });
          assert.equal(deployed.finalOutcome, "succeeded");
          const deployedRecord = JSON.parse(await fsp.readFile(deployed.resultRecordPath, "utf8"));
          assert.ok(deployedRecord.componentArtifacts[0].object);
          assert.match(
            deployedRecord.componentArtifacts[0].storedArtifactPath,
            /^artifact-object:\/\//,
          );
          const replaySnapshot = JSON.parse(
            await fsp.readFile(deployedRecord.replaySnapshotPath, "utf8"),
          );
          assert.ok(replaySnapshot.componentArtifacts[0].object);
          assert.match(
            replaySnapshot.componentArtifacts[0].storedArtifactPath,
            /^artifact-object:\/\//,
          );
          const renderedSnapshotPath = replaySnapshot.providerConfigSnapshotPath;
          const renderedSnapshot = await fsp.readFile(renderedSnapshotPath, "utf8");
          await fsp.writeFile(
            renderedSnapshotPath,
            renderedSnapshot.replace("shared-observability.example.test", "tampered.example.test"),
            "utf8",
          );
          await assert.rejects(
            buildSnapshotWithInfisicalAdmission(infisical.siteUrl, {
              workspaceRoot: tmp,
              recordsRoot,
              request: {
                schemaVersion: KUBERNETES_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
                submissionId: "kube-worker-retry-tampered",
                submittedAt: new Date().toISOString(),
                deployment,
                operationKind: "retry",
                sourceRunId: deployed.deployRunId,
                admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
                smokeConnectOverride,
              },
            }),
            /provider config snapshot drifted/,
          );
          await fsp.writeFile(renderedSnapshotPath, renderedSnapshot, "utf8");
          await writeValues(tmp, deployment.deploymentId);
          const retry = await buildSnapshotWithInfisicalAdmission(infisical.siteUrl, {
            workspaceRoot: tmp,
            recordsRoot,
            objectStore,
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
          assert.equal(
            retry.preparedPublisherConfig?.renderedConfigPath,
            deploy.preparedPublisherConfig?.renderedConfigPath,
          );
          await fsp.writeFile(
            path.join(
              tmp,
              "projects",
              "deployments",
              deployment.deploymentId,
              "helm",
              "values.yaml",
            ),
            "chart: ./charts/api\ncluster: retry-drift\n",
            "utf8",
          );
          const replayed = await executeFrozenProviderSnapshotAndReadSubmission({
            tmp,
            recordsRoot,
            provider: "kube-retry",
            execute: executeKubernetesControlPlaneSubmission,
            snapshot: retry,
            objectStore,
          });
          assert.equal(replayed.finalOutcome, "succeeded");
        },
      );
    } finally {
      await server.close();
      await infisical.close();
    }
  });
});
