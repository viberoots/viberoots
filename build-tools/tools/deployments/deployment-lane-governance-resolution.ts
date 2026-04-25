#!/usr/bin/env zx-wrapper
import {
  evaluateLaneGovernanceFact,
  type DeploymentLaneGovernanceFact,
} from "./deployment-admission-governance.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import type { DeploymentLanePolicy } from "./deployment-policy.ts";

export type DeploymentLaneGovernanceTarget = {
  lanePolicyRef: string;
  environmentStage: string;
  lanePolicy: DeploymentLanePolicy;
};

export type DeploymentLaneGovernanceResolver = (opts: {
  deployment: DeploymentLaneGovernanceTarget;
}) => Promise<DeploymentLaneGovernanceFact>;

function laneGovernanceError(target: DeploymentLaneGovernanceTarget, message: string): never {
  throw new DeploymentAdmissionError(
    "no_longer_admitted",
    `lane governance verification failed for ${target.lanePolicyRef}: ${message}`,
  );
}

export async function resolveLaneGovernanceFact(opts: {
  deployment: DeploymentLaneGovernanceTarget;
  evidence?: DeploymentLaneGovernanceFact;
  resolver?: DeploymentLaneGovernanceResolver;
}): Promise<DeploymentLaneGovernanceFact> {
  if (opts.evidence) {
    return evaluateLaneGovernanceFact({
      deployment: opts.deployment,
      evidence: opts.evidence,
    });
  }
  if (!opts.resolver) {
    laneGovernanceError(
      opts.deployment,
      `protected/shared admission requires governance verification for ${opts.deployment.lanePolicyRef}`,
    );
  }
  try {
    return evaluateLaneGovernanceFact({
      deployment: opts.deployment,
      evidence: await opts.resolver({ deployment: opts.deployment }),
    });
  } catch (error) {
    if (error instanceof DeploymentAdmissionError) throw error;
    laneGovernanceError(opts.deployment, error instanceof Error ? error.message : String(error));
  }
}
