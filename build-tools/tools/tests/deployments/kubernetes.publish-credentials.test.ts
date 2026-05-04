#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KubernetesPublishCredentialsError,
  publishCredentialContractRefs,
  resolveKubernetesPublishCredentials,
  validateKubernetesPublishRequirementsDeclared,
} from "../../deployments/kubernetes-publish-credentials";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";
import {
  REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
  reviewedKubernetesPublishRequirements,
} from "./kubernetes.publish-credentials.fixture";

function fakeRuntime(values: Record<string, string>) {
  const calls: string[] = [];
  return {
    calls,
    runtime: {
      async enterStep(step: "publish") {
        calls.push(step);
        return values;
      },
    },
  };
}

test("validate rejects protected/shared deployment with no publish secret_requirements", () => {
  const deployment = kubernetesDeploymentFixture();
  assert.throws(
    () => validateKubernetesPublishRequirementsDeclared(deployment),
    (error: unknown) =>
      error instanceof KubernetesPublishCredentialsError && error.reason === "missing",
  );
});

test("validate rejects requirements declared at the wrong lifecycle step", () => {
  const deployment = kubernetesDeploymentFixture({
    secretRequirements: [
      {
        name: "kubernetes_smoke_token",
        step: "smoke",
        contractId: REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
        required: true,
      },
    ],
  });
  assert.throws(
    () => validateKubernetesPublishRequirementsDeclared(deployment),
    (error: unknown) =>
      error instanceof KubernetesPublishCredentialsError && error.reason === "wrong_step",
  );
});

test("validate rejects duplicate publish requirement names", () => {
  const requirement = reviewedKubernetesPublishRequirements()[0];
  const deployment = kubernetesDeploymentFixture({
    secretRequirements: [requirement, requirement],
  });
  assert.throws(
    () => validateKubernetesPublishRequirementsDeclared(deployment),
    (error: unknown) =>
      error instanceof KubernetesPublishCredentialsError && error.reason === "duplicate",
  );
});

test("validate rejects publish requirement declared with non-secret_runtime source (wrong_scope)", () => {
  const deployment = kubernetesDeploymentFixture({
    secretRequirements: [
      {
        name: "kubernetes_publish_kubeconfig",
        step: "publish",
        contractId: REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
        required: true,
        source: "runtime_config",
      },
    ],
  });
  assert.throws(
    () => validateKubernetesPublishRequirementsDeclared(deployment),
    (error: unknown) =>
      error instanceof KubernetesPublishCredentialsError && error.reason === "wrong_scope",
  );
});

test("validate rejects publish requirement with empty contractId (ambient_only)", () => {
  const deployment = kubernetesDeploymentFixture({
    secretRequirements: [
      {
        name: "kubernetes_publish_kubeconfig",
        step: "publish",
        contractId: "   ",
        required: true,
      },
    ],
  });
  assert.throws(
    () => validateKubernetesPublishRequirementsDeclared(deployment),
    (error: unknown) =>
      error instanceof KubernetesPublishCredentialsError && error.reason === "ambient_only",
  );
});

test("resolve enters publish step exactly once and exposes redacted provenance", async () => {
  const deployment = kubernetesDeploymentFixture({
    secretRequirements: reviewedKubernetesPublishRequirements(),
  });
  const fake = fakeRuntime({ kubernetes_publish_kubeconfig: "vault:fake" });
  const resolved = await resolveKubernetesPublishCredentials({
    deployment,
    secretRuntime: fake.runtime,
  });
  assert.deepEqual(fake.calls, ["publish"]);
  assert.deepEqual(resolved.envNames, ["kubernetes_publish_kubeconfig"]);
  assert.deepEqual(resolved.contractRefs, [REVIEWED_KUBERNETES_PUBLISH_CONTRACT]);
  assert.equal(resolved.env.kubernetes_publish_kubeconfig, "vault:fake");
});

test("resolve rejects when secret runtime returns no credentials for protected deployment", async () => {
  const deployment = kubernetesDeploymentFixture({
    secretRequirements: reviewedKubernetesPublishRequirements(),
  });
  const fake = fakeRuntime({});
  await assert.rejects(
    resolveKubernetesPublishCredentials({ deployment, secretRuntime: fake.runtime }),
    (error: unknown) =>
      error instanceof KubernetesPublishCredentialsError && error.reason === "ambient_only",
  );
});

test("publishCredentialContractRefs returns sorted unique publish-step contract ids", () => {
  const deployment = kubernetesDeploymentFixture({
    secretRequirements: [
      ...reviewedKubernetesPublishRequirements(),
      {
        name: "kubernetes_smoke_token",
        step: "smoke",
        contractId: "vault:secret/kubernetes/shared-observability/smoke",
        required: false,
      },
    ],
  });
  assert.deepEqual(publishCredentialContractRefs(deployment), [
    REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
  ]);
});
