#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerCapabilityFor } from "../../deployments/deployment-provider-capabilities.ts";
import { assertReviewedRuntimeParity } from "../../deployments/provider-capabilities/runtime-parity.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import {
  readRecord,
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { installFakeKubernetesHelm } from "./kubernetes.fake-helm.ts";
import { installKubernetesTargets, kubernetesDeploymentFixture } from "./kubernetes.fixture.ts";
import { startKubernetesPublicServer } from "./kubernetes.public-server.ts";

async function writeArtifact(root: string, body: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "service.txt"), body, "utf8");
}

async function writeValues(root: string, deploymentId: string) {
  const configPath = path.join(
    root,
    "projects",
    "deployments",
    deploymentId,
    "helm",
    "values.yaml",
  );
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(
    configPath,
    "chart: ./charts/api\nsmoke_url: http://shared-observability.example.test/healthz\nsmoke_expect_contains: api\n",
    "utf8",
  );
}

function fakeHelmOverrides(fake: Awaited<ReturnType<typeof installFakeKubernetesHelm>>) {
  return {
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    BNX_KUBERNETES_HELM_BIN: path.join(fake.binDir, "helm"),
    BNX_KUBERNETES_FAKE_PUBLISH_ROOT: fake.publishRoot,
    BNX_KUBERNETES_FAKE_HELM_LOG: fake.logPath,
  };
}

test("public kubernetes deploy requires a control-plane URL for protected/shared targets", async () => {
  await runInTemp("kubernetes-public-service-required", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir, "service-required\n");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    await writeValues(tmp, deployment.deploymentId);
    const evidence = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    await assert.rejects(
      $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactDir} --admission-evidence-json ${evidence}`,
      /kubernetes (shared_nonprod|production_facing) mutation requires --control-plane-url or BNX_DEPLOY_CONTROL_PLANE_URL/,
    );
  });
});

test("public kubernetes deploy routes deploy, provision-only, and rollback through the control-plane service", async () => {
  await runInTemp("kubernetes-public-service-flow", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture({
      provisioner: { type: "terraform-stack", config: "terraform/main.tf.json" },
    });
    const artifactA = path.join(tmp, "artifact-a");
    const artifactB = path.join(tmp, "artifact-b");
    const fake = await installFakeKubernetesHelm(tmp);
    await writeArtifact(artifactA, "api-a\n");
    await writeArtifact(artifactB, "api-b\n");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    await writeValues(tmp, deployment.deploymentId);
    const evidence = await writeReviewedLaneAdmissionEvidenceJson({
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
      await withEnvOverrides(fakeHelmOverrides(fake), async () => {
        const harness = await startControlPlaneHarness({
          workspaceRoot: tmp,
          hostRoot: path.join(tmp, "host"),
          recordsRoot: path.join(tmp, "records"),
        });
        try {
          const first = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: { ...process.env },
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactA} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`
              ).stdout,
            ),
          );
          assert.equal(first.finalOutcome, "succeeded");
          const provisionOnly = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: { ...process.env },
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --provision-only --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url}`
              ).stdout,
            ),
          );
          assert.equal(provisionOnly.finalOutcome, "succeeded");
          await $({
            cwd: tmp,
            stdio: "pipe",
            env: { ...process.env },
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactB} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`;
          const rollback = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: { ...process.env },
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --publish-only --rollback --source-run-id ${first.deployRunId} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`
              ).stdout,
            ),
          );
          assert.equal(rollback.finalOutcome, "succeeded");
          const record = await readRecord(harness.controlPlane.url, rollback.deployRunId);
          assert.equal(record.provider, "kubernetes");
          const capability = providerCapabilityFor("kubernetes");
          assert.ok(capability);
          assertReviewedRuntimeParity({ provider: "kubernetes", capability });
        } finally {
          await harness.close();
        }
      });
    } finally {
      await server.close();
    }
  });
});
