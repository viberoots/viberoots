#!/usr/bin/env zx-wrapper
import type { DeploymentAdmissionPolicy, DeploymentLanePolicy } from "./deployment-policy";
import type { DeploymentExtractionContext } from "./contract-extract-shared";
import { isStaleEnvironmentBranchRef, sourceRefAllowed } from "./deployment-source-ref-policy";

function deploymentError(label: string, message: string): string {
  return `${label}: ${message}`;
}

function missingRequiredValues(required: string[], actual: string[]): string[] {
  const actualValues = new Set(actual);
  return required.filter((entry) => !actualValues.has(entry));
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
    const sourceRef = lanePolicy.sourceRefPolicy[opts.environmentStage];
    if (sourceRef && isStaleEnvironmentBranchRef(sourceRef)) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `source_ref_policy must not use environment branch ${sourceRef}`,
        ),
      );
    }
    const sourceGovernance = lanePolicy.governance.sourceRefPolicies.find(
      (entry) => entry.stage === opts.environmentStage,
    );
    if (!sourceGovernance) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `lane governance ${lanePolicy.governanceRef} does not define stage ${opts.environmentStage}`,
        ),
      );
    } else if (
      sourceGovernance &&
      sourceRef &&
      !sourceRefAllowed(sourceRef, sourceGovernance.allowedRefs)
    ) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `lane governance ${lanePolicy.governanceRef} source ref mismatch for ${opts.environmentStage}`,
        ),
      );
    } else if (
      admissionPolicy &&
      sourceGovernance.requiredChecks.join("\n") !== admissionPolicy.requiredChecks.join("\n")
    ) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `admission_policy ${opts.admissionPolicyRef} required_checks must match governance for ${opts.environmentStage}`,
        ),
      );
    } else if (
      sourceGovernance.requiredChecks.length > 0 &&
      lanePolicy.governance.trustedReporterIdentities.length === 0
    ) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `lane governance ${lanePolicy.governanceRef} must define trusted reporters for required checks`,
        ),
      );
    }
    if (admissionPolicy && sourceRef && !sourceRefAllowed(sourceRef, admissionPolicy.allowedRefs)) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `admission_policy ${opts.admissionPolicyRef} must allow source ref ${sourceRef}`,
        ),
      );
    }
    const approvalBoundary = lanePolicy.governance.requiredApprovalBoundaries.find(
      (entry) => entry.stage === opts.environmentStage,
    );
    if (admissionPolicy && approvalBoundary) {
      const missingApprovals = missingRequiredValues(
        approvalBoundary.requiredApprovals,
        admissionPolicy.requiredApprovals,
      );
      if (missingApprovals.length > 0) {
        opts.errors.push(
          deploymentError(
            opts.label,
            `admission_policy ${opts.admissionPolicyRef} required_approvals must include governance boundary for ${opts.environmentStage}: ${missingApprovals.join(", ")}`,
          ),
        );
      }
    }
  }
  return { lanePolicy, admissionPolicy };
}
