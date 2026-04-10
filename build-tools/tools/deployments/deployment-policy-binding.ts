#!/usr/bin/env zx-wrapper
import type { DeploymentAdmissionPolicy, DeploymentLanePolicy } from "./deployment-policy.ts";
import type { DeploymentExtractionContext } from "./contract-extract-shared.ts";

function deploymentError(label: string, message: string): string {
  return `${label}: ${message}`;
}

export function resolveSharedDeploymentPolicies(opts: {
  context: DeploymentExtractionContext;
  label: string;
  lanePolicyRef: string;
  admissionPolicyRef: string;
  environmentStage: string;
  errors: string[];
}): {
  lanePolicy?: DeploymentLanePolicy;
  admissionPolicy?: DeploymentAdmissionPolicy;
} {
  const lanePolicy = opts.context.lanePolicies.get(opts.lanePolicyRef);
  const admissionPolicy = opts.context.admissionPolicies.get(opts.admissionPolicyRef);
  if (!opts.lanePolicyRef)
    opts.errors.push(deploymentError(opts.label, "missing required lane_policy"));
  if (!opts.environmentStage) {
    opts.errors.push(deploymentError(opts.label, "missing required environment_stage"));
  }
  if (!opts.admissionPolicyRef) {
    opts.errors.push(deploymentError(opts.label, "missing required admission_policy"));
  }
  if (opts.lanePolicyRef && !lanePolicy) {
    opts.errors.push(
      deploymentError(opts.label, `lane_policy target not found: ${opts.lanePolicyRef}`),
    );
  }
  if (opts.admissionPolicyRef && !admissionPolicy) {
    opts.errors.push(
      deploymentError(opts.label, `admission_policy target not found: ${opts.admissionPolicyRef}`),
    );
  }
  if (lanePolicy) {
    if (!lanePolicy.stages.includes(opts.environmentStage)) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `environment_stage "${opts.environmentStage}" is not defined by lane_policy ${opts.lanePolicyRef}`,
        ),
      );
    }
    const stageBranch = lanePolicy.stageBranches[opts.environmentStage];
    const governanceProtection = lanePolicy.governance.branchProtections.find(
      (entry) => entry.stage === opts.environmentStage,
    );
    if (!governanceProtection) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `lane governance ${lanePolicy.governanceRef} does not define stage ${opts.environmentStage}`,
        ),
      );
    } else if (governanceProtection.branch !== stageBranch) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `lane governance ${lanePolicy.governanceRef} branch mismatch for ${opts.environmentStage}`,
        ),
      );
    } else if (
      admissionPolicy &&
      governanceProtection.requiredChecks.join("\n") !== admissionPolicy.requiredChecks.join("\n")
    ) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `admission_policy ${opts.admissionPolicyRef} required_checks must match governance for ${opts.environmentStage}`,
        ),
      );
    }
    if (admissionPolicy && stageBranch && !admissionPolicy.allowedRefs.includes(stageBranch)) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `admission_policy ${opts.admissionPolicyRef} must allow stage branch ${stageBranch}`,
        ),
      );
    }
  }
  return { lanePolicy, admissionPolicy };
}
