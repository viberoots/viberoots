#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import {
  deploymentPolicyResourceBindings,
  policyResourceRefFacts,
} from "./deployment-policy-resources";

export function deploymentRefs(deployment: DeploymentTarget): string[] {
  return [
    ...(deployment.deploymentFamily ? [deployment.deploymentFamily] : []),
    ...deployment.components.map((component) => componentResourceId(deployment, component.id)),
    deployment.providerTarget.identity,
    environmentStageResourceId(deployment),
    deployment.lanePolicyRef,
    deployment.lanePolicy.governanceRef,
    deployment.admissionPolicyRef,
    ...deploymentPolicyResourceBindings(deployment).map((binding) => binding.resourceId),
    ...policyChildResourceIds(deployment),
    ...requirementResourceIds(deployment),
    ...resolvedInputResourceIds(deployment),
    ...deployment.releaseActions.map((action) => action.ref),
    ...deployment.targetExceptions.map((exception) => exception.ref),
    ...("provisioner" in deployment && deployment.provisioner
      ? [provisionerResourceId(deployment)]
      : []),
    artifactInputResourceId(deployment),
  ];
}

export function deploymentRefFacts(deployment: DeploymentTarget): Record<string, unknown> {
  return {
    providerTargetIdentity: deployment.providerTarget.identity,
    lanePolicyRef: deployment.lanePolicyRef,
    admissionPolicyRef: deployment.admissionPolicyRef,
    ...policyResourceRefFacts(deployment),
    secretRequirementRefs: deployment.secretRequirements.map((requirement) =>
      secretRequirementResourceId(deployment, requirement.step, requirement.name),
    ),
    runtimeConfigRequirementRefs: deployment.runtimeConfigRequirements.map((requirement) =>
      runtimeConfigRequirementResourceId(deployment, requirement.step, requirement.name),
    ),
  };
}

export function componentResourceId(deployment: DeploymentTarget, componentId: string): string {
  return `${deployment.deploymentId}:${componentId}`;
}

export function environmentStageResourceId(deployment: DeploymentTarget): string {
  return `${deployment.deploymentId}:${deployment.environmentStage}`;
}

export function provisionerResourceId(deployment: DeploymentTarget): string {
  return `${deployment.deploymentId}:provisioner`;
}

export function artifactInputResourceId(deployment: DeploymentTarget): string {
  return `${deployment.deploymentId}:artifact-input`;
}

export function secretRequirementResourceId(
  deployment: DeploymentTarget,
  step: string,
  name: string,
): string {
  return `${deployment.deploymentId}:secret:${step}:${name}`;
}

export function runtimeConfigRequirementResourceId(
  deployment: DeploymentTarget,
  step: string,
  name: string,
): string {
  return `${deployment.deploymentId}:runtime-config:${step}:${name}`;
}

export function controlPlaneSelectionResourceId(deploymentId: string, controlPlaneName: string) {
  return `${deploymentId}:${controlPlaneName}`;
}

function policyChildResourceIds(deployment: DeploymentTarget): string[] {
  return [
    ...(deployment.rolloutPolicy ? [`${deployment.deploymentId}:rollout`] : []),
    ...(deployment.preview ? [`${deployment.deploymentId}:preview`] : []),
    ...(deployment.smoke ? [`${deployment.deploymentId}:smoke`] : []),
    ...(deployment.admissionPolicy.readinessGates || []).map(
      (gate) => `${deployment.deploymentId}:readiness:${gate.name}`,
    ),
    ...(deployment.admissionPolicy.attestation ? [`${deployment.deploymentId}:attestation`] : []),
    ...(deployment.admissionPolicy.sbom ? [`${deployment.deploymentId}:sbom`] : []),
    ...deployment.admissionPolicy.supplyChainGates.map(
      (_gate, index) => `${deployment.deploymentId}:supply-chain:${index}`,
    ),
    ...deployment.lanePolicy.governance.sourceRefPolicies.map(
      (sourceRef) => `${deployment.lanePolicy.governanceRef}:${sourceRef.stage}`,
    ),
  ];
}

function requirementResourceIds(deployment: DeploymentTarget): string[] {
  return [
    ...deployment.secretRequirements.map((requirement) =>
      secretRequirementResourceId(deployment, requirement.step, requirement.name),
    ),
    ...deployment.runtimeConfigRequirements.map((requirement) =>
      runtimeConfigRequirementResourceId(deployment, requirement.step, requirement.name),
    ),
  ];
}

function resolvedInputResourceIds(deployment: DeploymentTarget): string[] {
  const context = deployment.deploymentContext;
  const controlPlane = deployment.controlPlane;
  return [
    ...(context ? [context.name] : []),
    ...(controlPlane
      ? [
          controlPlane.name,
          controlPlaneSelectionResourceId(deployment.deploymentId, controlPlane.name),
          `${controlPlane.name}:service-client`,
        ]
      : []),
  ];
}
