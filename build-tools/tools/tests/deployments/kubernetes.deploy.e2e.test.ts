#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitKubernetesDeploy } from "../../deployments/kubernetes-deploy";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { installFakeKubernetesHelm } from "./kubernetes.fake-helm";
import {
  installKubernetesTargets,
  kubernetesDeploymentFixture,
  writeKubernetesLiveStateFixture,
} from "./kubernetes.fixture";
import {
  REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
  reviewedKubernetesPublishRequirements,
} from "./kubernetes.publish-credentials.fixture";
import { startKubernetesPublicServer } from "./kubernetes.public-server";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";

async function writeKubernetesPublishSecretFixture(tmp: string): Promise<string> {
  const fixturePath = path.join(tmp, "kubernetes-publish-secrets.json");
  await fsp.writeFile(
    fixturePath,
    JSON.stringify({
      schemaVersion: "deployment-secret-fixture@1",
      contracts: {
        [REVIEWED_KUBERNETES_PUBLISH_CONTRACT]: {
          value: "vault-fake-kubeconfig",
          allowedSteps: ["publish"],
          targetScopes: ["*"],
        },
      },
    }),
    "utf8",
  );
  return fixturePath;
}

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

test("kubernetes deploy CLI completes single-service publish with reviewed provisioner plan", async () => {
  await runInTemp("kubernetes-e2e-single", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture({
      provisioner: { type: "terraform-stack", config: "terraform/main.tf.json" },
      secretRequirements: reviewedKubernetesPublishRequirements(),
    });
    const secretFixturePath = await writeKubernetesPublishSecretFixture(tmp);
    const deploymentJson = path.join(tmp, "deployment.json");
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
      [
        "chart: ./charts/api",
        "smoke_url: http://shared-observability.example.test/healthz",
        "smoke_expect_contains: api",
        "",
      ].join("\n"),
    );
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
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
    try {
      const result = await $({
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fake.binDir}:${process.env.PATH || ""}`,
          VBR_KUBERNETES_HELM_BIN: path.join(fake.binDir, "helm"),
          VBR_KUBERNETES_FAKE_PUBLISH_ROOT: fake.publishRoot,
          VBR_KUBERNETES_FAKE_HELM_LOG: fake.logPath,
          VBR_KUBERNETES_LIVE_STATE_PATH: liveStatePath,
          [DEPLOYMENT_SECRET_FIXTURE_PATH_ENV]: secretFixturePath,
        },
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy-internal.ts")} --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.finalOutcome, "succeeded");
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.provider, "kubernetes");
      assert.equal(record.runnerIdentities.publisher, deployment.publisher.type);
      assert.equal(record.runnerIdentities.provisioner, "terraform-stack");
      assert.equal(record.runnerIdentities.smoke, "kubernetes-release-smoke@1");
      assert.equal(record.provisionerType, "terraform-stack");
      assert.equal(record.componentResults.length, 1);
      assert.equal(record.smokeOutcome, "passed");
      assert.ok(record.provisionerPlan?.artifactPath);
      assert.deepEqual(record.publisherCredentials?.envNames, ["kubernetes_publish_kubeconfig"]);
      assert.deepEqual(record.publisherCredentials?.contractRefs, [
        REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
      ]);
      assert.equal(JSON.stringify(record).includes("vault-fake-kubeconfig"), false);
    } finally {
      await server.close();
    }
  });
});

test("kubernetes deploy preserves ordered multi-component publish state", async () => {
  await runInTemp("kubernetes-e2e-multi", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture({
      secretRequirements: reviewedKubernetesPublishRequirements(),
      components: [
        { id: "api", kind: "service", target: "//projects/apps/api:image" },
        {
          id: "otel-sidecar",
          kind: "third-party-service",
          target: "//projects/observability/otel-sidecar:image",
        },
      ],
      rolloutPolicy: {
        mode: "ordered_best_effort",
        abort: "stop_on_first_failure",
        smoke: "final_only",
        steps: ["api", "otel-sidecar"],
      },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const recordsRoot = path.join(tmp, "records");
    const apiArtifact = path.join(tmp, "artifact-api");
    const sidecarArtifact = path.join(tmp, "artifact-sidecar");
    const fake = await installFakeKubernetesHelm(tmp);
    const liveStatePath = await writeKubernetesLiveStateFixture(tmp, deployment);
    const secretFixturePath = await writeKubernetesPublishSecretFixture(tmp);
    await writeServiceArtifact(apiArtifact, "api-service\n");
    await writeServiceArtifact(sidecarArtifact, "otel-sidecar\n");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    await writeHelmValues(
      tmp,
      deployment.deploymentId,
      [
        "chart: ./charts/shared-observability",
        "smoke_url: http://shared-observability.example.test/healthz",
        "smoke_expect_contains: otel-sidecar",
        "",
      ].join("\n"),
    );
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
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
    try {
      const result = await $({
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fake.binDir}:${process.env.PATH || ""}`,
          VBR_KUBERNETES_HELM_BIN: path.join(fake.binDir, "helm"),
          VBR_KUBERNETES_FAKE_PUBLISH_ROOT: fake.publishRoot,
          VBR_KUBERNETES_FAKE_HELM_LOG: fake.logPath,
          VBR_KUBERNETES_LIVE_STATE_PATH: liveStatePath,
          [DEPLOYMENT_SECRET_FIXTURE_PATH_ENV]: secretFixturePath,
        },
      })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy-internal.ts")} --deployment ${deployment.label} --component-artifacts api=${apiArtifact},otel-sidecar=${sidecarArtifact} --admission-evidence-json ${admissionEvidenceJson} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`;
      const summary = JSON.parse(String(result.stdout));
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.runnerIdentities.publisher, deployment.publisher.type);
      assert.equal(record.runnerIdentities.smoke, "kubernetes-release-smoke@1");
      assert.deepEqual(
        record.componentResults.map((entry: { componentId: string }) => entry.componentId),
        ["api", "otel-sidecar"],
      );
      const logLines = String(await fsp.readFile(fake.logPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { componentId: string });
      assert.deepEqual(
        logLines.map((entry) => entry.componentId),
        ["api", "otel-sidecar"],
      );
    } finally {
      await server.close();
    }
  });
});
