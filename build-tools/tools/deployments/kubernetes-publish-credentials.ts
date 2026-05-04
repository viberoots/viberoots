#!/usr/bin/env zx-wrapper
import type { KubernetesDeployment } from "./contract.ts";
import { isProtectedDeploymentClass } from "./deployment-control-plane-resilience-policy.ts";
import type { DeploymentRequirement } from "./deployment-requirements.ts";

export type KubernetesPublishCredentialsRejectionReason =
  | "missing"
  | "wrong_step"
  | "wrong_scope"
  | "duplicate"
  | "ambient_only";

export class KubernetesPublishCredentialsError extends Error {
  readonly reason: KubernetesPublishCredentialsRejectionReason;
  constructor(reason: KubernetesPublishCredentialsRejectionReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "KubernetesPublishCredentialsError";
  }
}

export type KubernetesPublishCredentialProvenance = {
  envNames: string[];
  contractRefs: string[];
};

export type KubernetesPublishCredentials = {
  env: Record<string, string>;
} & KubernetesPublishCredentialProvenance;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function requiresKubernetesPublishCredentialReview(
  deployment: Pick<KubernetesDeployment, "protectionClass">,
): boolean {
  return isProtectedDeploymentClass(deployment.protectionClass);
}

export function validateKubernetesPublishRequirementsDeclared(
  deployment: KubernetesDeployment,
): void {
  if (!requiresKubernetesPublishCredentialReview(deployment)) return;
  const requirements = deployment.secretRequirements || [];
  const publishRequirements = requirements.filter((requirement) => requirement.step === "publish");
  if (publishRequirements.length === 0) {
    if (requirements.some((requirement) => requirement.step !== "publish")) {
      throw new KubernetesPublishCredentialsError(
        "wrong_step",
        `kubernetes ${deployment.protectionClass} publish requires reviewed publish-step secret_requirements; declared steps: ${uniqueSorted(requirements.map((requirement) => requirement.step)).join(", ")}`,
      );
    }
    throw new KubernetesPublishCredentialsError(
      "missing",
      `kubernetes ${deployment.protectionClass} publish requires reviewed secret_requirements at the publish step (ambient cluster credentials are not accepted)`,
    );
  }
  ensureUniqueRequirementNames(publishRequirements);
  ensurePublishRequirementsScopedToSecretRuntime(publishRequirements);
  ensureContractIdsBound(publishRequirements);
}

const KUBERNETES_PUBLISH_TARGET_SCOPE = "secret_runtime";

function ensurePublishRequirementsScopedToSecretRuntime(
  publishRequirements: DeploymentRequirement[],
): void {
  for (const requirement of publishRequirements) {
    if (requirement.source && requirement.source !== KUBERNETES_PUBLISH_TARGET_SCOPE) {
      throw new KubernetesPublishCredentialsError(
        "wrong_scope",
        `kubernetes publish secret requirement "${requirement.name}" must use ${KUBERNETES_PUBLISH_TARGET_SCOPE} (got "${requirement.source}")`,
      );
    }
  }
}

function ensureUniqueRequirementNames(publishRequirements: DeploymentRequirement[]): void {
  const seen = new Set<string>();
  for (const requirement of publishRequirements) {
    if (seen.has(requirement.name)) {
      throw new KubernetesPublishCredentialsError(
        "duplicate",
        `kubernetes publish secret requirement "${requirement.name}" is declared more than once`,
      );
    }
    seen.add(requirement.name);
  }
}

function ensureContractIdsBound(publishRequirements: DeploymentRequirement[]): void {
  for (const requirement of publishRequirements) {
    if (!requirement.contractId.trim()) {
      throw new KubernetesPublishCredentialsError(
        "ambient_only",
        `kubernetes publish secret requirement "${requirement.name}" must bind a reviewed contractId (ambient provider env is not accepted)`,
      );
    }
  }
}

export function publishCredentialContractRefs(deployment: KubernetesDeployment): string[] {
  return uniqueSorted(
    (deployment.secretRequirements || [])
      .filter((requirement) => requirement.step === "publish")
      .map((requirement) => requirement.contractId)
      .filter((contractId) => contractId.trim().length > 0),
  );
}

export async function resolveKubernetesPublishCredentials(opts: {
  deployment: KubernetesDeployment;
  secretRuntime: { enterStep(step: "publish"): Promise<Record<string, string>> };
}): Promise<KubernetesPublishCredentials> {
  validateKubernetesPublishRequirementsDeclared(opts.deployment);
  const env = await opts.secretRuntime.enterStep("publish");
  const envNames = uniqueSorted(Object.keys(env));
  const contractRefs = publishCredentialContractRefs(opts.deployment);
  if (requiresKubernetesPublishCredentialReview(opts.deployment) && envNames.length === 0) {
    throw new KubernetesPublishCredentialsError(
      "ambient_only",
      `kubernetes ${opts.deployment.protectionClass} publish requires reviewed secret-runtime credentials; secret runtime returned no publish-step credentials`,
    );
  }
  return { env, envNames, contractRefs };
}
