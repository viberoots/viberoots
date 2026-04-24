#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";

export type DeploymentAdmissionRequirementsForCli = {
  admission_policy: string;
  allowed_refs: string[];
  required_checks: string[];
  required_approvals: string[];
  mark_check_passed: {
    relevant_for_workflow: boolean;
    authorization_required: "admission_reporter";
  };
};

export function deploymentAdmissionRequirementsForCli(
  deployment: DeploymentTarget,
): DeploymentAdmissionRequirementsForCli {
  return {
    admission_policy: deployment.admissionPolicyRef,
    allowed_refs: [...deployment.admissionPolicy.allowedRefs],
    required_checks: [...deployment.admissionPolicy.requiredChecks],
    required_approvals: [...deployment.admissionPolicy.requiredApprovals],
    mark_check_passed: {
      relevant_for_workflow: deployment.admissionPolicy.requiredChecks.length > 0,
      authorization_required: "admission_reporter",
    },
  };
}

export function missingMarkCheckPassedValueMessage(deployment: DeploymentTarget): string {
  const requirements = deploymentAdmissionRequirementsForCli(deployment);
  return [
    "--mark-check-passed requires one or more check names.",
    `Inspect reviewed deployment requirements with: deploy --deployment ${deployment.label} --validate-only`,
    `admission_policy: ${requirements.admission_policy}`,
    requirements.required_checks.length > 0
      ? `required_checks: ${requirements.required_checks.join(", ")}`
      : `${deployment.label} has no required_checks in ${requirements.admission_policy}.`,
    "Discovering required check names does not grant admission_reporter authorization.",
  ].join("\n");
}
