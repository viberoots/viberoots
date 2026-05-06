#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitKubernetesDeploy } from "../../deployments/kubernetes-deploy";
import { submitKubernetesExactArtifactRun } from "../../deployments/kubernetes-exact-run";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { installFakeKubernetesHelm } from "./kubernetes.fake-helm";
import { installKubernetesTargets, kubernetesDeploymentFixture } from "./kubernetes.fixture";
import {
  REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
  fakeKubernetesPublishSecretRuntime,
  reviewedKubernetesPublishRequirements,
  setKubernetesPublishSecretFixtureEnv,
  writeKubernetesPublishSecretFixture,
} from "./kubernetes.publish-credentials.fixture";
import { startKubernetesPublicServer } from "./kubernetes.public-server";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";

async function writeHelmValues(root: string, deploymentId: string, content: string): Promise<void> {
  const configPath = path.join(
    root,
    "projects",
    "deployments",
    deploymentId,
    "helm",
    "values.yaml",
  );
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, content, "utf8");
}

test("deploy rejects protected/shared kubernetes service without publish secret_requirements", async () => {
  await runInTemp("kubernetes-publish-creds-missing", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture();
    const recordsRoot = path.join(tmp, "records");
    const artifactDir = path.join(tmp, "artifact");
    const fake = await installFakeKubernetesHelm(tmp);
    await writeServiceArtifact(artifactDir, "api-service\n");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    await writeHelmValues(
      tmp,
      deployment.deploymentId,
      [
        "chart: ./charts/api",
        "smoke_url: http://shared-observability.example.test/healthz",
        "smoke_expect_contains: api",
        "",
      ].join("\n"),
    );
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const previous = { ...process.env };
    process.env.PATH = `${fake.binDir}:${previous.PATH || ""}`;
    process.env.BNX_KUBERNETES_HELM_BIN = path.join(fake.binDir, "helm");
    process.env.BNX_KUBERNETES_FAKE_PUBLISH_ROOT = fake.publishRoot;
    process.env.BNX_KUBERNETES_FAKE_HELM_LOG = fake.logPath;
    try {
      await assert.rejects(
        async () =>
          await submitKubernetesDeploy({
            workspaceRoot: tmp,
            deployment,
            recordsRoot,
            artifactDir,
            admissionEvidence: JSON.parse(await fsp.readFile(admissionEvidenceJson, "utf8")),
          }),
        /publish requires reviewed secret_requirements/,
      );
    } finally {
      process.env.PATH = previous.PATH || "";
      delete process.env.BNX_KUBERNETES_HELM_BIN;
      delete process.env.BNX_KUBERNETES_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_KUBERNETES_FAKE_HELM_LOG;
    }
  });
});

type ExactRunOperationKind = "retry" | "rollback" | "promotion";

async function exerciseExactArtifactRun(operationKind: ExactRunOperationKind): Promise<void> {
  await runInTemp(`kubernetes-publish-creds-exact-${operationKind}`, async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture({
      secretRequirements: reviewedKubernetesPublishRequirements(),
    });
    const secretFixturePath = await writeKubernetesPublishSecretFixture(tmp);
    const fixtureEnv = setKubernetesPublishSecretFixtureEnv(secretFixturePath);
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeKubernetesHelm(tmp);
    const componentId = "api";
    const artifactIdentity = "node-service:api";
    const storedArtifactPath = path.join(tmp, "artifact-store", componentId);
    await fsp.mkdir(storedArtifactPath, { recursive: true });
    await fsp.writeFile(path.join(storedArtifactPath, "marker"), "stored\n", "utf8");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    await writeHelmValues(
      tmp,
      deployment.deploymentId,
      [
        "chart: ./charts/api",
        "smoke_url: http://shared-observability.example.test/healthz",
        "smoke_expect_contains: api",
        "",
      ].join("\n"),
    );
    const server = await startKubernetesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
    });
    const previous = { ...process.env };
    process.env.PATH = `${fake.binDir}:${previous.PATH || ""}`;
    process.env.BNX_KUBERNETES_HELM_BIN = path.join(fake.binDir, "helm");
    process.env.BNX_KUBERNETES_FAKE_PUBLISH_ROOT = fake.publishRoot;
    process.env.BNX_KUBERNETES_FAKE_HELM_LOG = fake.logPath;
    try {
      const sourceRevision = `rev-publish-creds-${operationKind}-1`;
      const sourceRecord = {
        deployRunId: `deploy-source-${operationKind}`,
        deploymentId: deployment.deploymentId,
        admittedContext: {
          source: {
            sourceRef: "env/pleomino/prod",
            sourceRevision,
          },
          admittedSecretReferences: [],
        },
      };
      const fakeRuntime = fakeKubernetesPublishSecretRuntime();
      const componentArtifacts = [{ componentId, identity: artifactIdentity, storedArtifactPath }];
      const admissionEvidence = deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind,
        sourceRevision,
        artifactIdentity,
        artifactLineageId: artifactIdentity,
      });
      const { record } = await submitKubernetesExactArtifactRun({
        workspaceRoot: tmp,
        deployment,
        recordsRoot,
        operationKind,
        componentArtifacts,
        sourceRecord,
        parentRunId: sourceRecord.deployRunId,
        releaseLineageId: "lineage-1",
        artifactLineageId: artifactIdentity,
        admissionEvidence,
        publishCredentials: fakeRuntime.hooks,
        smokeConnectOverride: {
          protocol: "http:",
          hostname: "127.0.0.1",
          port: server.port,
        },
      });
      assert.equal(record.operationKind, operationKind);
      assert.equal(record.finalOutcome, "succeeded");
      // Exact-artifact reuse: the recorded artifact identity matches the input.
      assert.equal(record.artifact?.identity, artifactIdentity);
      assert.equal(record.artifactLineageId, artifactIdentity);
      assert.equal(record.componentResults?.[0]?.artifactIdentity, artifactIdentity);
      // Publish credentials resolve through the target's reviewed publish-step
      // secret_requirements: only the env names and reviewed contract refs surface,
      // and the secret runtime entered the publish step exactly once.
      assert.deepEqual(record.publisherCredentials?.envNames, ["kubernetes_publish_kubeconfig"]);
      assert.deepEqual(record.publisherCredentials?.contractRefs, [
        REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
      ]);
      assert.deepEqual(fakeRuntime.steps, ["publish"]);
      // Resolved credential values must not be persisted in the record.
      assert.equal(JSON.stringify(record).includes("vault:fake"), false);
    } finally {
      process.env.PATH = previous.PATH || "";
      delete process.env.BNX_KUBERNETES_HELM_BIN;
      delete process.env.BNX_KUBERNETES_FAKE_PUBLISH_ROOT;
      delete process.env.BNX_KUBERNETES_FAKE_HELM_LOG;
      fixtureEnv.restore();
      await server.close();
    }
  });
}

test("retry preserves exact-artifact replay while resolving publish credentials", async () => {
  await exerciseExactArtifactRun("retry");
});

test("rollback preserves exact-artifact replay while resolving publish credentials", async () => {
  await exerciseExactArtifactRun("rollback");
});

test("promotion preserves exact-artifact replay while resolving publish credentials", async () => {
  await exerciseExactArtifactRun("promotion");
});
