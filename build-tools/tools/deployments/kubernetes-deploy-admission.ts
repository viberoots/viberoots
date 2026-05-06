#!/usr/bin/env zx-wrapper
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { evaluateDeploymentAdmission } from "./deployment-admission-evaluator";
import type { KubernetesDeployment } from "./contract";
import {
  admitKubernetesComponentArtifacts,
  type AdmittedKubernetesComponentArtifact,
} from "./kubernetes-artifacts";
import { artifactByComponentId, requiredArtifactPaths } from "./kubernetes-deploy-helpers";
import {
  resolveInitialKubernetesAdmittedContext,
  type KubernetesAdmittedContext,
} from "./kubernetes-admission";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";

export async function resolveKubernetesDeployAdmission(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  recordsRoot: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  componentArtifacts?: AdmittedKubernetesComponentArtifact[];
  admittedContext?: KubernetesAdmittedContext;
  submissionId?: string;
  expectedSourceRevision?: string;
  admissionEvidence?: DeploymentAdmissionEvidence;
  provisionerPlanFingerprint?: string;
}) {
  const admittedArtifacts =
    opts.componentArtifacts ||
    (await admitKubernetesComponentArtifacts({
      recordsRoot: opts.recordsRoot,
      artifactPathsByComponentId: requiredArtifactPaths(
        opts.deployment,
        opts.artifactDir,
        opts.artifactDirsByComponentId,
      ),
    }));
  const compositeArtifactIdentity = fingerprintValue({
    providerTargetIdentity: opts.deployment.providerTarget.providerTargetIdentity,
    componentArtifacts: admittedArtifacts.map((artifact) => ({
      componentId: artifact.componentId,
      identity: artifact.identity,
    })),
  });
  const admittedContext =
    opts.admittedContext ||
    (await resolveInitialKubernetesAdmittedContext({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      artifactIdentity: compositeArtifactIdentity,
      ...(opts.submissionId ? { submissionId: opts.submissionId } : {}),
      ...(opts.expectedSourceRevision
        ? { expectedSourceRevision: opts.expectedSourceRevision }
        : {}),
    }));
  admittedContext.policyEvaluation =
    admittedContext.policyEvaluation ||
    (await evaluateDeploymentAdmission({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deployment: opts.deployment,
      operationKind: "deploy",
      admittedContext,
      artifactLineageId: compositeArtifactIdentity,
      evidence: {
        ...(opts.admissionEvidence || {}),
        ...(opts.provisionerPlanFingerprint
          ? { provisionerPlanFingerprint: opts.provisionerPlanFingerprint }
          : {}),
      },
    }));
  return {
    admittedArtifacts,
    artifactsByComponent: artifactByComponentId(admittedArtifacts),
    compositeArtifactIdentity,
    admittedContext,
  };
}
