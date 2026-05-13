#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { classifyOpenTofuPlan, OPENTOFU_STACK_PROVISIONER } from "../../deployments/opentofu-stack";
import { promotionCompatibilityErrors } from "../../deployments/deployment-promotion-compatibility";
import {
  extractKubernetesDeployments,
  type KubernetesDeployment,
} from "../../deployments/contract";
import { runInTemp } from "../lib/test-helpers";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import {
  nixosSharedHostLaneGovernanceNodeFixture,
  writeReviewedLaneAdmissionEvidenceJson,
} from "./deployment-lane-governance.fixture";
import {
  installKubernetesTargets,
  kubernetesAdmissionPolicyNodeFixture,
  kubernetesDeploymentFixture,
  kubernetesLanePolicyNodeFixture,
} from "./kubernetes.fixture";
import {
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import {
  installFakeOpenTofu,
  reviewedOpenTofuSecretRequirements,
  writeOpenTofuSecretFixture,
} from "./kubernetes.opentofu-apply.integration.helpers";

function openTofuDeployment(): KubernetesDeployment {
  return kubernetesDeploymentFixture({
    secretRequirements: reviewedOpenTofuSecretRequirements(),
    provisioner: {
      type: OPENTOFU_STACK_PROVISIONER,
      config: "opentofu/stack.json",
      stackDirectory: "opentofu",
      stackIdentity: "foundation/prod",
      stateBackendIdentity: "s3://state-prod/foundation",
      allowedEnvironmentDifferences: ["stack_identity"],
    },
  });
}

async function writeOpenTofuStack(
  root: string,
  deployment: KubernetesDeployment,
  actions: string[],
) {
  const stackRoot = path.join(root, "projects", "deployments", deployment.deploymentId, "opentofu");
  await fsp.mkdir(stackRoot, { recursive: true });
  await fsp.writeFile(
    path.join(stackRoot, "stack.json"),
    JSON.stringify(
      {
        plan_json: "plan.json",
        apply_plan: "plan.tfplan",
        provider_lock: "providers.lock.hcl",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fsp.writeFile(
    path.join(stackRoot, "plan.json"),
    JSON.stringify(
      {
        resource_changes: [
          {
            address: "module.foundation.null_resource.safe",
            change: { actions },
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fsp.writeFile(path.join(stackRoot, "plan.tfplan"), "saved opentofu plan fixture\n", "utf8");
}

test("classifyOpenTofuPlan accepts no-op/create/update and rejects destructive actions", () => {
  assert.deepEqual(classifyOpenTofuPlan({ resource_changes: [] }), {
    mutationClass: "no_op",
    resourceChangeCount: 0,
    actions: [],
  });
  assert.equal(
    classifyOpenTofuPlan({
      resource_changes: [{ change: { actions: ["create", "update"] } }],
    }).mutationClass,
    "non_destructive",
  );
  assert.throws(
    () => classifyOpenTofuPlan({ resource_changes: [{ change: { actions: ["delete"] } }] }),
    /opentofu plan action "delete" is not safe/,
  );
});

test("extractKubernetesDeployments reads opentofu-stack metadata", () => {
  const deployment = openTofuDeployment();
  const { deployments, errors } = extractKubernetesDeployments([
    { name: deployment.component.target, labels: ["kind:app"] },
    kubernetesLanePolicyNodeFixture(),
    nixosSharedHostLaneGovernanceNodeFixture(),
    kubernetesAdmissionPolicyNodeFixture({ required_checks: ["deploy/pleomino-prod"] }),
    {
      name: deployment.label,
      provider: "kubernetes",
      component: deployment.component.target,
      component_kind: deployment.component.kind,
      components: deployment.components,
      publisher: deployment.publisher.type,
      publisher_config: deployment.publisher.config,
      provisioner: OPENTOFU_STACK_PROVISIONER,
      provisioner_config: "opentofu/stack.json",
      protection_class: deployment.protectionClass,
      lane_policy: deployment.lanePolicyRef,
      environment_stage: deployment.environmentStage,
      admission_policy: deployment.admissionPolicyRef,
      secret_requirements: [
        {
          name: "opentofu-provider-credentials",
          step: "provision",
          contract_id: "deploy/opentofu/provider/prod",
          required: "true",
        },
      ],
      runtime_config_requirements: [],
      provider_target: {
        cluster: deployment.providerTarget.cluster,
        namespace: deployment.providerTarget.namespace,
        release: deployment.providerTarget.release,
        stack_identity: "foundation/prod",
        state_backend_identity: "s3://state-prod/foundation",
      },
    },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.provisioner?.type, OPENTOFU_STACK_PROVISIONER);
  assert.equal(deployments[0]?.provisioner?.stackIdentity, "foundation/prod");
});

test("opentofu promotion compatibility binds stack and state backend identity", () => {
  const current = openTofuDeployment();
  const source = openTofuDeployment();
  source.deploymentId = "shared-observability-staging";
  source.label = "//projects/deployments/shared-observability-staging:deploy";
  source.environmentStage = "staging";
  source.provisioner = {
    type: OPENTOFU_STACK_PROVISIONER,
    config: "opentofu/stack.json",
    stackDirectory: "opentofu",
    stackIdentity: "foundation/staging",
    stateBackendIdentity: "s3://state-staging/foundation",
    allowedEnvironmentDifferences: ["stack_identity"],
  };
  const errors = promotionCompatibilityErrors(current, {
    record: {
      finalOutcome: "succeeded",
      publishMode: "normal",
      deploymentId: source.deploymentId,
    },
    replaySnapshot: {
      artifactIdentity: "sha256:artifact",
      admittedContext: {
        lanePolicyFingerprint: current.lanePolicy.fingerprint,
        source: { sourceRevision: "abc123" },
      },
      deployment: source,
    },
  });
  assert.deepEqual(errors, [
    "opentofu state backend mismatch: current=s3://state-prod/foundation source=s3://state-staging/foundation",
  ]);
});

test("protected kubernetes provision-only records opentofu plan fingerprints", async () => {
  await runInTemp("kubernetes-opentofu-provision-only", async (tmp, $) => {
    const deployment = openTofuDeployment();
    await installKubernetesTargets(tmp, [deployment]);
    await writeOpenTofuStack(tmp, deployment, ["create"]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    const evidence = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const fakeOpenTofu = await installFakeOpenTofu(tmp);
    const secretFixturePath = await writeOpenTofuSecretFixture(tmp);
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    });
    try {
      await withEnvOverrides(
        {
          VBR_OPENTOFU_BIN: fakeOpenTofu.binPath,
          VBR_FAKE_OPENTOFU_LOG: fakeOpenTofu.logPath,
          [DEPLOYMENT_SECRET_FIXTURE_PATH_ENV]: secretFixturePath,
        },
        async () => {
          const result = await $({
            cwd: tmp,
            stdio: "pipe",
          })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --provision-only --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url}`;
          const summary = JSON.parse(String(result.stdout));
          assert.equal(summary.finalOutcome, "succeeded");
          assert.equal(summary.provisionerType, OPENTOFU_STACK_PROVISIONER);
          assert.equal(summary.provisionerPlan.mutationClass, "non_destructive");
          assert.equal(summary.provisionerApplyOutcome.status, "succeeded");
          assert.equal(summary.provisionerApplyOutcome.command.binary, fakeOpenTofu.binPath);
          assert.match(summary.provisionerPlan.planFingerprint, /^sha256:/);
          assert.match(
            summary.admittedContext.policyEvaluation.binding.provisionerPlanFingerprint,
            /^sha256:/,
          );
        },
      );
    } finally {
      await harness.close();
    }
  });
});
