#!/usr/bin/env zx-wrapper
import type {
  DeploymentRequirement,
  DeploymentRequirementStep,
} from "./deployment-requirements.ts";

export type DeploymentSecretBackendKind = "vault";

export type DeploymentSecretContractBinding = {
  name: string;
  step: DeploymentRequirementStep;
  contractId: string;
  required: boolean;
  backend: DeploymentSecretBackendKind;
  referenceId: string;
};

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
  bindings: DeploymentSecretContractBinding[],
  step: DeploymentRequirementStep,
): DeploymentSecretContractBinding[] {
  return bindings.filter((binding) => binding.step === step);
}
