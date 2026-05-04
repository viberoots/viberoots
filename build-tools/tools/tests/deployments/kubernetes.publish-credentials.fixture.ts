#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEPLOYMENT_SECRET_FIXTURE_PATH_ENV } from "../../deployments/deployment-secret-fixture";
import type { DeploymentRequirement } from "../../deployments/deployment-requirements";
import type { KubernetesPublishCredentialsHooks } from "../../deployments/kubernetes-publish-credentials-orchestration";

export const REVIEWED_KUBERNETES_PUBLISH_CONTRACT =
  "vault:secret/kubernetes/shared-observability/publish-kubeconfig";

export async function writeKubernetesPublishSecretFixture(tmp: string): Promise<string> {
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

export function setKubernetesPublishSecretFixtureEnv(fixturePath: string): {
  restore(): void;
} {
  const previous = process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
  process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = fixturePath;
  return {
    restore() {
      if (previous === undefined) delete process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV];
      else process.env[DEPLOYMENT_SECRET_FIXTURE_PATH_ENV] = previous;
    },
  };
}

export function reviewedKubernetesPublishRequirements(): DeploymentRequirement[] {
  return [
    {
      name: "kubernetes_publish_kubeconfig",
      step: "publish",
      contractId: REVIEWED_KUBERNETES_PUBLISH_CONTRACT,
      required: true,
    },
  ];
}

export type FakePublishSecretRuntime = {
  steps: string[];
  hooks: KubernetesPublishCredentialsHooks;
};

export function fakeKubernetesPublishSecretRuntime(
  values: Record<string, string> = { kubernetes_publish_kubeconfig: "vault:fake" },
): FakePublishSecretRuntime {
  const steps: string[] = [];
  return {
    steps,
    hooks: {
      secretRuntimeFactory: () => ({
        async enterStep(step) {
          steps.push(step);
          return values;
        },
      }),
    },
  };
}
