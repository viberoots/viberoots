#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitKubernetesDeploy } from "../../deployments/kubernetes-deploy";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import { OPENTOFU_STACK_PROVISIONER } from "../../deployments/opentofu-stack";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { installFakeKubernetesHelm } from "./kubernetes.fake-helm";
import { installKubernetesTargets, kubernetesDeploymentFixture } from "./kubernetes.fixture";
import {
  REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
  fakeKubernetesPublishSecretRuntime,
  reviewedKubernetesPublishRequirements,
} from "./kubernetes.publish-credentials.fixture";
import { startKubernetesPublicServer } from "./kubernetes.public-server";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";
import {
  INTEGRATION_SECRET_VALUE,
  installFakeOpenTofu,
  openTofuProvisioner,
  reviewedOpenTofuSecretRequirements,
  writeOpenTofuSecretFixture,
  writeOpenTofuStackFixture,
} from "./kubernetes.opentofu-apply.integration.helpers";

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

test("kubernetes app-attached deploy attaches OpenTofu apply outcome with replay evidence", async () => {
  await runInTemp("kubernetes-opentofu-deploy-attached", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture({
      provisioner: openTofuProvisioner(),
      secretRequirements: [
        ...reviewedKubernetesPublishRequirements(),
        ...reviewedOpenTofuSecretRequirements(),
      ],
    });
    const publishRuntime = fakeKubernetesPublishSecretRuntime();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeKubernetesHelm(tmp);
    const fakeOpenTofu = await installFakeOpenTofu(tmp);
    const openTofuSecretFixturePath = await writeOpenTofuSecretFixture(tmp, {
      [REVIEWED_KUBERNETES_PUBLISH_CONTRACT]: {
        value: "vault-fake-kubeconfig",
        allowedSteps: ["publish"],
        targetScopes: ["*"],
      },
    });
    await writeServiceArtifact(artifactDir, "api-service\n");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    await writeOpenTofuStackFixture({
      workspaceRoot: tmp,
      deploymentId: deployment.deploymentId,
    });
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
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-opentofu-deploy-attached",
      artifactIdentity: "artifact-opentofu-deploy-attached",
      artifactLineageId: "artifact-opentofu-deploy-attached",
    });
    const server = await startKubernetesPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
    });
    const originalEnv = { ...process.env };
    process.env.PATH = `${fake.binDir}:${originalEnv.PATH || ""}`;
    process.env.VBR_KUBERNETES_HELM_BIN = path.join(fake.binDir, "helm");
    process.env.VBR_KUBERNETES_FAKE_PUBLISH_ROOT = fake.publishRoot;
    process.env.VBR_KUBERNETES_FAKE_HELM_LOG = fake.logPath;
    process.env.VBR_OPENTOFU_BIN = fakeOpenTofu.binPath;
    process.env.VBR_FAKE_OPENTOFU_LOG = fakeOpenTofu.logPath;
    process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = openTofuSecretFixturePath;
    try {
      const { record, recordPath } = await submitKubernetesDeploy({
        workspaceRoot: tmp,
        deployment,
        artifactDir,
        recordsRoot,
        admissionEvidence,
        publishCredentials: publishRuntime.hooks,
        smokeConnectOverride: {
          protocol: "http:",
          hostname: "127.0.0.1",
          port: server.port,
        },
      });
      assert.equal(record.finalOutcome, "succeeded");
      assert.equal(record.provisionerApplyOutcome?.status, "succeeded");
      assert.equal(record.provisionerApplyOutcome?.stackIdentity, "foundation/integration");
      const opentofuLog = await fsp.readFile(fakeOpenTofu.logPath, "utf8");
      assert.match(opentofuLog, /vault:secret\/opentofu/);
      assert.match(opentofuLog, /plan\.tfplan/);
      assert.ok(record.replaySnapshotPath, "replay snapshot path must be recorded");
      const replayBody = JSON.parse(await fsp.readFile(record.replaySnapshotPath!, "utf8"));
      assert.equal(replayBody.deployRunId, record.deployRunId);
      assert.equal(
        replayBody.deployment.provisioner.type,
        OPENTOFU_STACK_PROVISIONER,
        "replay snapshot must capture the OpenTofu provisioner",
      );
      const persisted = await fsp.readFile(recordPath, "utf8");
      assert.ok(
        !persisted.includes(INTEGRATION_SECRET_VALUE),
        "persisted deploy record must not contain the resolved secret value",
      );
      assert.ok(persisted.includes("opentofu_provider_credentials"));
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      for (const name of [
        "VBR_KUBERNETES_HELM_BIN",
        "VBR_KUBERNETES_FAKE_PUBLISH_ROOT",
        "VBR_KUBERNETES_FAKE_HELM_LOG",
        "VBR_OPENTOFU_BIN",
        "VBR_FAKE_OPENTOFU_LOG",
        DEPLOYMENT_SECRET_FIXTURE_PATH_ENV,
      ]) {
        if (originalEnv[name] === undefined) delete process.env[name];
        else process.env[name] = originalEnv[name];
      }
      await server.close();
    }
  });
});
