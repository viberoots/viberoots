#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitKubernetesDeploy } from "../../deployments/kubernetes-deploy";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { installFakeKubernetesHelm } from "./kubernetes.fake-helm";
import {
  installKubernetesTargets,
  kubernetesDeploymentFixture,
  writeKubernetesLiveStateFixture,
} from "./kubernetes.fixture";
import {
  fakeKubernetesPublishSecretRuntime,
  reviewedKubernetesPublishRequirements,
  setKubernetesPublishSecretFixtureEnv,
  writeKubernetesPublishSecretFixture,
} from "./kubernetes.publish-credentials.fixture";
import { startKubernetesPublicServer } from "./kubernetes.public-server";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";

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

test("kubernetes deploy records service-health smoke failure after publish", async () => {
  await runInTemp("kubernetes-e2e-smoke-failure", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture({
      secretRequirements: reviewedKubernetesPublishRequirements(),
    });
    const fakeRuntime = fakeKubernetesPublishSecretRuntime();
    const secretFixturePath = await writeKubernetesPublishSecretFixture(tmp);
    const fixtureEnv = setKubernetesPublishSecretFixtureEnv(secretFixturePath);
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeKubernetesHelm(tmp);
    const liveStatePath = await writeKubernetesLiveStateFixture(tmp, deployment);
    await writeServiceArtifact(artifactDir, "api-service\n");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    await writeHelmValues(
      tmp,
      deployment.deploymentId,
      "chart: ./charts/api\nsmoke_url: http://shared-observability.example.test/healthz\nsmoke_expect_contains: missing\n",
    );
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
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
    process.env.VBR_KUBERNETES_LIVE_STATE_PATH = liveStatePath;
    try {
      await assert.rejects(
        async () =>
          await submitKubernetesDeploy({
            workspaceRoot: tmp,
            deployment,
            recordsRoot,
            artifactDir,
            admissionEvidence: JSON.parse(await fsp.readFile(admissionEvidenceJson, "utf8")),
            publishCredentials: fakeRuntime.hooks,
            smokeConnectOverride: {
              protocol: "http:",
              hostname: "127.0.0.1",
              port: server.port,
            },
          }),
        (error: any) => {
          assert.equal(error.record.finalOutcome, "smoke_failed_after_publish");
          assert.equal(error.record.failedStep, "smoke");
          return true;
        },
      );
    } finally {
      process.env.PATH = originalEnv.PATH || "";
      delete process.env.VBR_KUBERNETES_HELM_BIN;
      delete process.env.VBR_KUBERNETES_FAKE_PUBLISH_ROOT;
      delete process.env.VBR_KUBERNETES_FAKE_HELM_LOG;
      delete process.env.VBR_KUBERNETES_LIVE_STATE_PATH;
      fixtureEnv.restore();
      await server.close();
    }
  });
});
