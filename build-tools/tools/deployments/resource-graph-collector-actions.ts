#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import {
  artifactInputResourceId,
  componentResourceId,
  provisionerResourceId,
} from "./resource-graph-collector-refs";
import {
  deploymentPolicyResourceBindings,
  releaseActionPolicyResourceId,
} from "./deployment-policy-resources";
import type { DeploymentResourceInventoryEntry } from "./resource-graph-types";

function base(label: string) {
  return { class: "buck" as const, label };
}

function entry(
  kind: DeploymentResourceInventoryEntry["kind"],
  id: string,
  label: string,
  refs: string[] = [],
  facts: Record<string, unknown> = {},
): DeploymentResourceInventoryEntry {
  return { kind, id, authority: "reviewed_intent", source: base(label), refs, facts };
}

export function collectActionAndArtifactResources(
  deployment: DeploymentTarget,
): DeploymentResourceInventoryEntry[] {
  return [
    ...deployment.releaseActions.map((action) =>
      entry("ReleaseAction", action.ref, action.ref, [deployment.deploymentId]),
    ),
    ...deployment.releaseActions.map((action) =>
      entry(
        "ReleaseActionPolicy",
        releaseActionPolicyResourceId(action.ref),
        action.ref,
        [action.ref],
        {
          actionType: action.type,
          phase: action.phase,
          replayPolicy: action.replayPolicy,
          policyResourceVersion: action.fingerprint,
          statusVisibility: "operator_status",
        },
      ),
    ),
    ...deployment.targetExceptions.map((targetException) =>
      entry(
        "DeploymentTargetException",
        targetException.ref,
        targetException.ref,
        [deployment.deploymentId],
        targetExceptionFacts(targetException),
      ),
    ),
    ...provisionerResources(deployment),
    artifactInput(deployment),
  ];
}

function provisionerResources(deployment: DeploymentTarget): DeploymentResourceInventoryEntry[] {
  if (!("provisioner" in deployment) || !deployment.provisioner) return [];
  return [
    entry(
      "Provisioner",
      provisionerResourceId(deployment),
      deployment.label,
      [
        deployment.deploymentId,
        deployment.providerTarget.identity,
        ...deploymentPolicyResourceBindings(deployment).map((binding) => binding.resourceId),
      ],
      provisionerFacts(deployment),
    ),
  ];
}

function provisionerFacts(deployment: DeploymentTarget): Record<string, unknown> {
  if (!("provisioner" in deployment) || !deployment.provisioner) return {};
  const provisioner = deployment.provisioner as any;
  return {
    provisionerResourceVersion: "provisioner-resource@1",
    provisionerType: provisioner.type,
    ...(provisioner.type === "opentofu-stack"
      ? {
          provisionerRole: "durable-cloud-infrastructure-evidence",
          stackIdentity: provisioner.stackIdentity,
          stateBackendIdentity: provisioner.stateBackendIdentity,
          stackDirectory: provisioner.stackDirectory,
          configPath: provisioner.config,
          planArtifactRef: { configPath: provisioner.config, configField: "plan_json" },
          applyArtifactRef: { configPath: provisioner.config, configField: "apply_plan" },
          evidenceArtifactRefs: ["provisioner_plan"],
          approvalBinding: {
            admissionPolicyRef: deployment.admissionPolicyRef,
            admissionPolicyFingerprint: deployment.admissionPolicy.fingerprint,
            lanePolicyRef: deployment.lanePolicyRef,
            lanePolicyFingerprint: deployment.lanePolicy.fingerprint,
            policyResourceRefs: deploymentPolicyResourceBindings(deployment),
            requiredApprovals: deployment.admissionPolicy.requiredApprovals || [],
          },
          policyEvaluationBinding: {
            source: "existing-admission-facts",
            provisionerPlanFingerprintField:
              "admittedContext.policyEvaluation.binding.provisionerPlanFingerprint",
          },
          replayCompatibility: {
            allowedEnvironmentDifferences: provisioner.allowedEnvironmentDifferences || [],
          },
          sourcePlanEvidenceBinding: "resource_graph_node.sourceSelection",
        }
      : {}),
  };
}

function artifactInput(deployment: DeploymentTarget): DeploymentResourceInventoryEntry {
  return entry(
    "ArtifactInput",
    artifactInputResourceId(deployment),
    deployment.label,
    [
      deployment.deploymentId,
      ...deployment.components.map((component) => componentResourceId(deployment, component.id)),
    ],
    { publisher: deployment.publisher.type },
  );
}

function targetExceptionFacts(
  targetException: DeploymentTarget["targetExceptions"][number],
): Record<string, unknown> {
  return {
    exceptionId: targetException.exceptionId,
    exceptionKind: targetException.exceptionKind,
    affectedDeploymentIds: targetException.affectedDeploymentIds,
    oldProviderTargetIdentity: targetException.oldProviderTargetIdentity,
    newProviderTargetIdentity: targetException.newProviderTargetIdentity,
    sharedLockScope: targetException.sharedLockScope,
    approvalEvidence: targetException.approvalEvidence,
    effectiveAt: targetException.effectiveAt,
    expiresAt: targetException.expiresAt,
    completionSignal: targetException.completionSignal,
    reconciliationOwner: targetException.reconciliationOwner,
    approvalBoundary: "reviewed-target-exception",
    statusVisibility: "operator_status",
  };
}
