#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitKubernetesProvisionOnly } from "../../deployments/kubernetes-provision-only";
import { OPENTOFU_STACK_PROVISIONER } from "../../deployments/opentofu-stack";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  INTEGRATION_SECRET_VALUE,
  fakeProvisionSecretRuntime,
  openTofuProvisioner,
  recordingApplyAdapter,
  writeOpenTofuStackFixture,
} from "./kubernetes.opentofu-apply.integration.helpers";
import { installKubernetesTargets, kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture";

test("kubernetes provision-only records OpenTofu apply success outcome and redacts secret values", async () => {
  await runInTemp("kubernetes-opentofu-provision-only-success", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture({ provisioner: openTofuProvisioner() });
    const recordsRoot = path.join(tmp, "records");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    await writeOpenTofuStackFixture({
      workspaceRoot: tmp,
      deploymentId: deployment.deploymentId,
    });
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "provision_only",
      sourceRevision: "rev-opentofu-provision-success",
      artifactIdentity: `provision-only:${deployment.providerTarget.providerTargetIdentity}`,
      artifactLineageId: `provision-only:${deployment.providerTarget.providerTargetIdentity}`,
    });
    const { adapter, calls } = recordingApplyAdapter({
      stdout: "apply complete resources 1 added",
    });
    const { record, recordPath } = await submitKubernetesProvisionOnly({
      workspaceRoot: tmp,
      deployment,
      recordsRoot,
      admissionEvidence,
      openTofuApply: {
        adapter,
        secretRuntimeFactory: fakeProvisionSecretRuntime({
          opentofu_provider_credentials: INTEGRATION_SECRET_VALUE,
        }),
      },
    });
    assert.equal(record.operationKind, "provision_only");
    assert.equal(record.finalOutcome, "succeeded");
    assert.equal(record.provisionerType, OPENTOFU_STACK_PROVISIONER);
    assert.ok(record.provisionerPlan?.artifactPath);
    assert.equal(record.provisionerApplyOutcome?.status, "succeeded");
    assert.equal(record.provisionerApplyOutcome?.exitCode, 0);
    assert.equal(record.provisionerApplyOutcome?.stackIdentity, "foundation/integration");
    assert.equal(
      record.provisionerApplyOutcome?.stateBackendIdentity,
      "s3://state-integration/foundation",
    );
    assert.deepEqual(record.provisionerApplyOutcome?.command.credentialEnvNames, [
      "opentofu_provider_credentials",
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].planArtifactPath, record.provisionerPlan?.artifactPath);
    const persisted = await fsp.readFile(recordPath, "utf8");
    assert.ok(
      !persisted.includes(INTEGRATION_SECRET_VALUE),
      "persisted record must not contain the resolved secret value",
    );
    assert.ok(persisted.includes("opentofu_provider_credentials"));
  });
});

test("kubernetes provision-only records OpenTofu apply failure outcome with redacted diagnostics", async () => {
  await runInTemp("kubernetes-opentofu-provision-only-failure", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture({ provisioner: openTofuProvisioner() });
    const recordsRoot = path.join(tmp, "records");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    await writeOpenTofuStackFixture({
      workspaceRoot: tmp,
      deploymentId: deployment.deploymentId,
    });
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "provision_only",
      sourceRevision: "rev-opentofu-provision-failure",
      artifactIdentity: `provision-only:${deployment.providerTarget.providerTargetIdentity}`,
      artifactLineageId: `provision-only:${deployment.providerTarget.providerTargetIdentity}`,
    });
    const { adapter } = recordingApplyAdapter({
      exitCode: 1,
      stderr: "Error: provider authorization failed token=ABC123XYZ secret=ZZZ private_key block",
    });
    const { record, recordPath } = await submitKubernetesProvisionOnly({
      workspaceRoot: tmp,
      deployment,
      recordsRoot,
      admissionEvidence,
      openTofuApply: {
        adapter,
        secretRuntimeFactory: fakeProvisionSecretRuntime({
          opentofu_provider_credentials: INTEGRATION_SECRET_VALUE,
        }),
      },
    });
    assert.equal(record.operationKind, "provision_only");
    assert.equal(record.finalOutcome, "publish_failed");
    assert.equal(record.provisionerApplyOutcome?.status, "failed");
    assert.equal(record.provisionerApplyOutcome?.exitCode, 1);
    assert.equal(
      record.provisionerApplyOutcome?.diagnostics?.classification,
      "redact_before_display",
    );
    assert.equal(record.provisionerApplyOutcome?.diagnostics?.redacted, true);
    assert.ok(!(record.provisionerApplyOutcome?.diagnostics?.summary || "").includes("ABC123XYZ"));
    const persisted = await fsp.readFile(recordPath, "utf8");
    assert.ok(!persisted.includes("ABC123XYZ"));
    assert.ok(!persisted.includes(INTEGRATION_SECRET_VALUE));
  });
});
