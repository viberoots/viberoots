#!/usr/bin/env zx-wrapper
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import type { DeploymentLaneGovernanceResolver } from "./deployment-lane-governance-resolution.ts";
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostControlPlaneSourceSelection } from "./nixos-shared-host-control-plane-snapshot.ts";

function mergedEvidence(
  evidence: DeploymentAdmissionEvidence | undefined,
  snapshot: NixosSharedHostControlPlaneSnapshot,
): DeploymentAdmissionEvidence {
  return {
    ...(evidence || {}),
    ...(snapshot.provisionerPlan?.fingerprint
      ? { provisionerPlanFingerprint: snapshot.provisionerPlan.fingerprint }
      : {}),
  };
}

function destructivePlanError(
  snapshot: NixosSharedHostControlPlaneSnapshot,
): DeploymentAdmissionError | undefined {
  return snapshot.provisionerPlan?.mutationClass === "destructive" &&
    snapshot.action.kind === "deploy"
    ? new DeploymentAdmissionError(
        "no_longer_admitted",
        `protected/shared routine deploy rejects destructive provisioner plan: ${snapshot.provisionerPlan.destructiveReasons.join("; ")}`,
      )
    : undefined;
}

export async function evaluateNixosSharedHostControlPlaneAdmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backendDatabaseUrl?: string;
  deployment: NixosSharedHostControlPlaneSnapshot["deployment"];
  snapshot: NixosSharedHostControlPlaneSnapshot;
  source?: NixosSharedHostControlPlaneSourceSelection;
  artifactLineageId?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  governanceResolver?: DeploymentLaneGovernanceResolver;
}) {
  const destructiveError = destructivePlanError(opts.snapshot);
  if (destructiveError) throw destructiveError;
  if (!opts.snapshot.admittedContext) return;
  opts.snapshot.admittedContext = {
    ...opts.snapshot.admittedContext,
    policyEvaluation: await evaluateDeploymentAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      backendDatabaseUrl: opts.backendDatabaseUrl,
      operationKind: opts.snapshot.operationKind,
      admittedContext: opts.snapshot.admittedContext,
      sourceRecord: opts.source?.record as any,
      artifactLineageId: opts.artifactLineageId,
      evidence: mergedEvidence(opts.admissionEvidence, opts.snapshot),
      governanceResolver: opts.governanceResolver,
    }),
  };
}
