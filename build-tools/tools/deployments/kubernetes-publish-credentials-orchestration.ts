#!/usr/bin/env zx-wrapper
import type { KubernetesDeployment } from "./contract.ts";
import type { KubernetesAdmittedContext } from "./kubernetes-admission.ts";
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers.ts";
import {
  publishCredentialContractRefs,
  requiresKubernetesPublishCredentialReview,
  resolveKubernetesPublishCredentials,
  type KubernetesPublishCredentials,
} from "./kubernetes-publish-credentials.ts";

export type KubernetesPublishCredentialsHooks = {
  secretRuntimeFactory?: (opts: {
    deployment: KubernetesDeployment;
    admittedContext: KubernetesAdmittedContext;
  }) => { enterStep(step: "publish"): Promise<Record<string, string>> };
};

function declaresPublishRequirements(deployment: KubernetesDeployment): boolean {
  return (deployment.secretRequirements || []).some(
    (requirement) => requirement.step === "publish",
  );
}

export function publisherCredentialFields(
  credentials: Pick<KubernetesPublishCredentials, "envNames" | "contractRefs">,
): { publisherCredentials?: { envNames: string[]; contractRefs: string[] } } {
  if (credentials.envNames.length === 0 && credentials.contractRefs.length === 0) return {};
  return {
    publisherCredentials: {
      envNames: credentials.envNames,
      contractRefs: credentials.contractRefs,
    },
  };
}

export async function resolveKubernetesPublishCredentialsForDeployment(opts: {
  deployment: KubernetesDeployment;
  admittedContext: KubernetesAdmittedContext;
  hooks?: KubernetesPublishCredentialsHooks;
}): Promise<KubernetesPublishCredentials> {
  if (
    !requiresKubernetesPublishCredentialReview(opts.deployment) &&
    !declaresPublishRequirements(opts.deployment)
  ) {
    return { env: {}, envNames: [], contractRefs: publishCredentialContractRefs(opts.deployment) };
  }
  const factory =
    opts.hooks?.secretRuntimeFactory ||
    ((args) =>
      createVaultDeploymentSecretRuntime({
        admittedContext: args.admittedContext,
        fallbackTargetScope: args.admittedContext.targetEnvironment.lockScope,
      }));
  const secretRuntime = factory({
    deployment: opts.deployment,
    admittedContext: opts.admittedContext,
  });
  return await resolveKubernetesPublishCredentials({
    deployment: opts.deployment,
    secretRuntime,
  });
}
