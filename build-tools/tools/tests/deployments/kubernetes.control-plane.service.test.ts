#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerCapabilityFor } from "../../deployments/deployment-provider-capabilities.ts";
import { reviewedRuntimeContractFor } from "../../deployments/provider-capabilities/runtime-contract.ts";
import { assertReviewedRuntimeParity } from "../../deployments/provider-capabilities/runtime-parity.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import {
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture.ts";
import { installHarnessClientProfile } from "./nixos-shared-host.remote-exec.install.helpers.ts";
import { installFakeKubernetesHelm } from "./kubernetes.fake-helm.ts";
import { installKubernetesTargets, kubernetesDeploymentFixture } from "./kubernetes.fixture.ts";
import { startKubernetesPublicServer } from "./kubernetes.public-server.ts";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture.ts";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture.ts";
import {
  reviewedKubernetesPublishRequirements,
  writeKubernetesPublishSecretFixture,
} from "./kubernetes.publish-credentials.fixture.ts";

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

function assertProtectedSharedControlPlaneRecord(
  record: { controlPlane?: { lockScope: string }; finalOutcome: string },
  lockScope: string,
) {
  assert.ok(record.controlPlane);
  assert.equal(record.controlPlane.lockScope, lockScope);
  assert.equal(record.finalOutcome, "succeeded");
}

test("public kubernetes deploy requires a control-plane URL for protected/shared targets", async () => {
  await runInTemp("kubernetes-public-service-required", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeServiceArtifact(artifactDir, "service-required\n");
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

test("public kubernetes deploy routes deploy, provision-only, retry, and rollback through the control-plane service", async () => {
  await runInTemp("kubernetes-public-service-flow", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture({
      lanePolicy: nixosSharedHostLanePolicyFixture({ defaultClientProfile: "mini" }),
      provisioner: { type: "terraform-stack", config: "terraform/main.tf.json" },
      secretRequirements: reviewedKubernetesPublishRequirements(),
      vaultRuntime: {
        addr: "https://vault.fixture.local:8200",
        oidcIssuer: "https://vault.fixture.local",
      },
    });
    const secretFixturePath = await writeKubernetesPublishSecretFixture(tmp);
    const artifactA = path.join(tmp, "artifact-a");
    const artifactB = path.join(tmp, "artifact-b");
    const fake = await installFakeKubernetesHelm(tmp);
    await writeServiceArtifact(artifactA, "api-a\n");
    await writeServiceArtifact(artifactB, "api-b\n");
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
      await withEnvOverrides(
        {
          ...fakeHelmOverrides(fake),
          [DEPLOYMENT_SECRET_FIXTURE_PATH_ENV]: secretFixturePath,
        },
        async () => {
          const harness = await startControlPlaneHarness({
            workspaceRoot: tmp,
            hostRoot: path.join(tmp, "host"),
            recordsRoot: path.join(tmp, "records"),
          });
          try {
            const profileRoot = await installHarnessClientProfile($, tmp, harness.controlPlane.url);
            const runtimeContract = reviewedRuntimeContractFor("kubernetes");
            const lockScope = deployment.providerTarget.providerTargetIdentity;
            const clientEnv = (() => {
              const e = { ...process.env };
              delete e[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
              return e;
            })();
            const first = JSON.parse(
              String(
                (
                  await $({
                    cwd: tmp,
                    stdio: "pipe",
                    env: clientEnv,
                  })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactA} --admission-evidence-json ${evidence} --profile-root ${profileRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`
                ).stdout,
              ),
            );
            assert.equal(first.finalOutcome, "succeeded");
            const firstRecord = first;
            const provisionOnly = JSON.parse(
              String(
                (
                  await $({
                    cwd: tmp,
                    stdio: "pipe",
                    env: clientEnv,
                  })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --provision-only --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url}`
                ).stdout,
              ),
            );
            assert.equal(provisionOnly.finalOutcome, "succeeded");
            const provisionOnlyRecord = provisionOnly;
            await $({
              cwd: tmp,
              stdio: "pipe",
              env: clientEnv,
            })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactB} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`;
            const retry = JSON.parse(
              String(
                (
                  await $({
                    cwd: tmp,
                    stdio: "pipe",
                    env: clientEnv,
                  })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --publish-only --source-run-id ${first.deployRunId} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`
                ).stdout,
              ),
            );
            assert.equal(retry.finalOutcome, "succeeded");
            const retryRecord = retry;
            const rollback = JSON.parse(
              String(
                (
                  await $({
                    cwd: tmp,
                    stdio: "pipe",
                    env: clientEnv,
                  })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --publish-only --rollback --source-run-id ${first.deployRunId} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol http:`
                ).stdout,
              ),
            );
            assert.equal(rollback.finalOutcome, "succeeded");
            const rollbackRecord = rollback;
            assert.equal(firstRecord.provider, "kubernetes");
            assert.equal(firstRecord.runClassification, "deploy");
            assert.equal(
              provisionOnlyRecord.runClassification,
              runtimeContract.provisionOnlyClassification,
            );
            assert.equal(
              retryRecord.runClassification,
              runtimeContract.sameDeploymentPublishOnlyClassification,
            );
            assert.equal(
              retryRecord.operationKind,
              runtimeContract.sameDeploymentPublishOnlyClassification,
            );
            assert.equal(retryRecord.parentRunId, first.deployRunId);
            assert.equal(retryRecord.releaseLineageId, first.deployRunId);
            assert.equal(retryRecord.artifactLineageId, firstRecord.artifact?.identity);
            assert.deepEqual(retryRecord.componentArtifacts, firstRecord.componentArtifacts);
            assert.equal(rollbackRecord.runClassification, runtimeContract.rollbackClassification);
            assert.equal(rollbackRecord.operationKind, runtimeContract.rollbackClassification);
            assert.equal(rollbackRecord.parentRunId, first.deployRunId);
            assert.equal(rollbackRecord.releaseLineageId, first.deployRunId);
            assert.equal(rollbackRecord.artifactLineageId, firstRecord.artifact?.identity);
            assert.deepEqual(rollbackRecord.componentArtifacts, firstRecord.componentArtifacts);
            if (runtimeContract.protectedSharedRequiresControlPlane) {
              for (const record of [
                firstRecord,
                provisionOnlyRecord,
                retryRecord,
                rollbackRecord,
              ]) {
                assertProtectedSharedControlPlaneRecord(record, lockScope);
              }
            }
            const capability = providerCapabilityFor("kubernetes");
            assert.ok(capability);
            assertReviewedRuntimeParity({ provider: "kubernetes", capability });
          } finally {
            await harness.close();
          }
        },
      );
    } finally {
      await server.close();
    }
  });
});
