#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitKubernetesDeploy } from "../../deployments/kubernetes-deploy.ts";
import { prepareKubernetesPublisherConfig } from "../../deployments/kubernetes-config.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture.ts";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";

test("kubernetes rejects provider config drift before publish begins", async () => {
  await runInTemp("kubernetes-config-drift", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeServiceArtifact(artifactDir, "drift\n");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
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
    assert.equal(body.service_kind, "web");
    assert.equal(body.ingress_mode, "public");
    assert.equal(body.health_path, "/healthz");
    assert.deepEqual(body.component_artifacts.api, {
      path: "/store/api",
      identity: "node-service:api",
    });
  });
});
