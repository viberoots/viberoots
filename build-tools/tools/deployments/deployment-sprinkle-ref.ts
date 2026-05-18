#!/usr/bin/env zx-wrapper
import type { DeploymentRequirement, DeploymentRequirementStep } from "./deployment-requirements";

export type DeploymentSecretBackendKind = "vault" | "infisical";
export type DeploymentSecretRefreshMode = "renew" | "reacquire" | "none";
export type DeploymentSecretCredentialClass = "routine" | "break_glass";

export type DeploymentSecretContractBinding = {
  name: string;
  step: DeploymentRequirementStep;
  contractId: string;
  required: boolean;
  backend: DeploymentSecretBackendKind;
  backendProfile?: string;
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
  backendProfile = backend === "infisical" ? "infisical-default" : "vault-default",
): DeploymentSecretContractBinding[] {
  return requirements.map((requirement) => ({
    name: requirement.name,
    step: requirement.step,
    contractId: requirement.contractId,
    required: requirement.required,
    backend,
    backendProfile,
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
