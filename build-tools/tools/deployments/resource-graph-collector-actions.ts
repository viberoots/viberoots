#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import {
  artifactInputResourceId,
  componentResourceId,
  provisionerResourceId,
} from "./resource-graph-collector-refs";
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
    entry("Provisioner", provisionerResourceId(deployment), deployment.label, [
      deployment.deploymentId,
      deployment.providerTarget.identity,
    ]),
  ];
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
