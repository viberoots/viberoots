#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitKubernetesDeploy } from "../../deployments/kubernetes-deploy";
import { prepareKubernetesPublisherConfig } from "../../deployments/kubernetes-config";
import { assertKubernetesLiveStateMatchesDeployment } from "../../deployments/kubernetes-live-drift";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";

test("kubernetes rejects provider config drift before publish begins", async () => {
  await runInTemp("kubernetes-config-drift", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeServiceArtifact(artifactDir, "drift\n");
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-kubernetes-config-drift-1",
      artifactIdentity: "artifact-kubernetes-config-drift-1",
      artifactLineageId: "artifact-kubernetes-config-drift-1",
    });
    const configPath = path.join(
      tmp,
      "projects",
      "deployments",
      deployment.deploymentId,
      "helm",
      "values.yaml",
    );
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(
      configPath,
      ["chart: ./charts/api", "cluster: prod-eu-central", ""].join("\n"),
      "utf8",
    );
    await assert.rejects(
      async () =>
        await submitKubernetesDeploy({
          workspaceRoot: tmp,
          deployment,
          artifactDir,
          recordsRoot: path.join(tmp, "records"),
          admissionEvidence,
        }),
      /does not match deployment provider_target\.cluster/,
    );
  });
});

test("kubernetes rendered service config records reviewed ingress posture", async () => {
  await runInTemp("kubernetes-service-config-render", async (tmp) => {
    const deployment = kubernetesDeploymentFixture({
      providerTarget: {
        serviceKind: "web",
        ingressMode: "public",
        healthPath: "/healthz",
      } as any,
    });
    const configPath = path.join(
      tmp,
      "projects",
      "deployments",
      deployment.deploymentId,
      "helm",
      "values.yaml",
    );
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(
      configPath,
      "chart: ./charts/api\nservice_kind: web\ningress_mode: public\nhealth_path: /healthz\n",
      "utf8",
    );
    const rendered = await prepareKubernetesPublisherConfig({
      workspaceRoot: tmp,
      deployment,
      componentArtifacts: { api: { path: "/store/api", identity: "node-service:api" } },
      outputPath: path.join(tmp, "rendered.json"),
    });
    const body = JSON.parse(await fsp.readFile(rendered.renderedConfigPath, "utf8"));
    assert.equal(body.provider_target_identity, deployment.providerTarget.providerTargetIdentity);
    assert.equal(body.service_kind, "web");
    assert.equal(body.ingress_mode, "public");
    assert.equal(body.health_path, "/healthz");
    assert.deepEqual(body.component_artifacts.api, {
      path: "/store/api",
      identity: "node-service:api",
    });
  });
});

test("kubernetes rejects provider config overrides for rendered identity fields", async () => {
  await runInTemp("kubernetes-provider-render-identity-drift", async (tmp) => {
    const deployment = kubernetesDeploymentFixture({
      providerTarget: {
        healthPath: "/healthz",
      } as any,
    });
    const configPath = path.join(
      tmp,
      "projects",
      "deployments",
      deployment.deploymentId,
      "helm",
      "values.yaml",
    );
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(
      configPath,
      [
        "chart: ./charts/api",
        "provider_target_identity: kubernetes:other/ns/release",
        "health_path: /readyz",
        "",
      ].join("\n"),
      "utf8",
    );
    await assert.rejects(
      prepareKubernetesPublisherConfig({
        workspaceRoot: tmp,
        deployment,
        componentArtifacts: { api: { path: "/store/api", identity: "node-service:api" } },
        outputPath: path.join(tmp, "rendered.json"),
      }),
      /provider_target_identity must come from Buck deployment metadata/,
    );
    await fsp.writeFile(
      configPath,
      ["chart: ./charts/api", "health_path: /readyz", ""].join("\n"),
      "utf8",
    );
    await assert.rejects(
      prepareKubernetesPublisherConfig({
        workspaceRoot: tmp,
        deployment,
        componentArtifacts: { api: { path: "/store/api", identity: "node-service:api" } },
        outputPath: path.join(tmp, "rendered.json"),
      }),
      /health_path .* does not match deployment/,
    );
  });
});

test("kubernetes live-state drift fails closed before publish mutation", async () => {
  await runInTemp("kubernetes-live-state-drift", async (tmp) => {
    const deployment = kubernetesDeploymentFixture();
    await assert.rejects(
      assertKubernetesLiveStateMatchesDeployment({ deployment }),
      /requires VBR_KUBERNETES_LIVE_STATE_PATH/,
    );
    await assert.rejects(
      assertKubernetesLiveStateMatchesDeployment({
        deployment,
        liveStatePath: path.join(tmp, "missing-live-state.json"),
      }),
      /live-state file is missing/,
    );
    const liveStatePath = path.join(tmp, "live-state.json");
    await fsp.writeFile(
      liveStatePath,
      JSON.stringify(
        {
          cluster: deployment.providerTarget.cluster,
          namespace: "drifted-namespace",
          release: deployment.providerTarget.release,
          providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await assert.rejects(
      assertKubernetesLiveStateMatchesDeployment({ deployment, liveStatePath }),
      /kubernetes live-state drift detected before publish[\s\S]*namespace/,
    );
  });
});
