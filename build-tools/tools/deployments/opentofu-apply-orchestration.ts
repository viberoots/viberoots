#!/usr/bin/env zx-wrapper
import type { KubernetesDeployment } from "./contract";
import type { KubernetesAdmittedContext } from "./kubernetes-admission";
import type { KubernetesProvisionerPlanRef } from "./kubernetes-provisioner-plan";
import { createVaultDeploymentSecretRuntime } from "./deployment-secret-runtime-helpers";
import {
  createProductionOpenTofuApplyAdapter,
  isOpenTofuProvisioner,
  runOpenTofuReviewedApply,
  type OpenTofuApplyAdapter,
  type OpenTofuApplyEvidence,
  type OpenTofuApplyOutcome,
} from "./opentofu-apply";

export type OpenTofuApplyHooks = {
  adapter?: OpenTofuApplyAdapter;
  adapterFactory?: () => OpenTofuApplyAdapter;
  evidence?: OpenTofuApplyEvidence;
  secretRuntimeFactory?: (opts: {
    deployment: KubernetesDeployment;
    admittedContext: KubernetesAdmittedContext;
  }) => { enterStep(step: "provision"): Promise<Record<string, string>> };
};

export async function maybeRunOpenTofuReviewedApply(opts: {
  deployment: KubernetesDeployment;
  admittedContext: KubernetesAdmittedContext;
  provisionerPlan: KubernetesProvisionerPlanRef | undefined;
  hooks: OpenTofuApplyHooks | undefined;
}): Promise<OpenTofuApplyOutcome | undefined> {
  const provisioner = opts.deployment.provisioner;
  if (!isOpenTofuProvisioner(provisioner)) return undefined;
  const adapter =
    opts.hooks?.adapter || opts.hooks?.adapterFactory?.() || createProductionOpenTofuApplyAdapter();
  if (!opts.provisionerPlan) {
    throw new Error("opentofu apply requires an admitted provisioner plan");
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
  return await runOpenTofuReviewedApply({
    provisioner,
    provisionerPlan: opts.provisionerPlan,
    admittedProvisionerPlanFingerprint:
      opts.admittedContext.policyEvaluation?.binding.provisionerPlanFingerprint,
    secretRuntime,
    adapter,
    ...(opts.hooks?.evidence ? { evidence: opts.hooks.evidence } : {}),
  });
}
