#!/usr/bin/env zx-wrapper
import type {
  DeploymentRequirement,
  DeploymentRequirementStep,
} from "./deployment-requirements.ts";

export type DeploymentSecretBackendKind = "vault";
export type DeploymentSecretRefreshMode = "renew" | "reacquire" | "none";
export type DeploymentSecretCredentialClass = "routine" | "break_glass";

export type DeploymentSecretContractBinding = {
  name: string;
  step: DeploymentRequirementStep;
  contractId: string;
  required: boolean;
  backend: DeploymentSecretBackendKind;
  referenceId: string;
};

export type DeploymentSecretAdmittedReference = DeploymentSecretContractBinding & {
  targetScope: string;
  backendRef: string;
  selectorRef: string;
  resolvedAt: string;
  resolvedVersion?: string;
  refreshMode: DeploymentSecretRefreshMode;
  credentialClass: DeploymentSecretCredentialClass;
};

export type DeploymentSecretReference =
  | DeploymentSecretContractBinding
  | DeploymentSecretAdmittedReference;

export function deploymentSecretContractBindings(
  requirements: DeploymentRequirement[],
  backend: DeploymentSecretBackendKind = "vault",
): DeploymentSecretContractBinding[] {
  return requirements.map((requirement) => ({
    name: requirement.name,
    step: requirement.step,
    contractId: requirement.contractId,
    required: requirement.required,
    backend,
    referenceId: `${backend}:${requirement.contractId}`,
  }));
}

export function deploymentSecretBindingsForStep(
  bindings: DeploymentSecretReference[],
  step: DeploymentRequirementStep,
): DeploymentSecretReference[] {
  return bindings.filter((binding) => binding.step === step);
}

export function isDeploymentSecretAdmittedReference(
  reference: DeploymentSecretReference,
): reference is DeploymentSecretAdmittedReference {
  return "backendRef" in reference && "selectorRef" in reference;
}
