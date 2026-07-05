#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import type { DeploymentResourceKind } from "./resource-graph-taxonomy";
import { providerCapabilityFor } from "./deployment-provider-capabilities";
import { fingerprintPolicy } from "./deployment-policy-fingerprint";

export type DeploymentPolicyResourceBinding = {
  kind: DeploymentResourceKind;
  resourceId: string;
  version: string;
};

const PROVIDER_CAPABILITY_VERSION = "provider-capability@1";

export function deploymentPolicyResourceBindings(
  deployment: DeploymentTarget,
): DeploymentPolicyResourceBinding[] {
  return uniquePolicyBindings([
    policy("LanePolicy", deployment.lanePolicyRef, deployment.lanePolicy.fingerprint),
    policy(
      "LaneGovernancePolicy",
      deployment.lanePolicy.governanceRef,
      deployment.lanePolicy.governance.fingerprint,
    ),
    policy(
      "AdmissionPolicy",
      deployment.admissionPolicyRef,
      deployment.admissionPolicy.fingerprint,
    ),
    ...stageOperationPolicies(deployment),
    ...readinessGatePolicies(deployment),
    ...admissionExtensionPolicies(deployment),
    ...laneSourceRefPolicies(deployment),
    ...deployment.releaseActions.map((action) =>
      policy("ReleaseActionPolicy", releaseActionPolicyResourceId(action.ref), action.fingerprint),
    ),
    ...providerCapabilityPolicy(deployment),
  ]);
}

export function policyResourceRefFacts(deployment: DeploymentTarget): Record<string, unknown> {
  return { policyResourceRefs: deploymentPolicyResourceBindings(deployment) };
}

export function releaseActionPolicyResourceId(actionRef: string): string {
  return `${actionRef}:policy`;
}

export function policyResourceVersion(policy: unknown): string {
  return fingerprintPolicy(policy);
}

function stageOperationPolicies(deployment: DeploymentTarget): DeploymentPolicyResourceBinding[] {
  return [
    ...(deployment.rolloutPolicy
      ? [
          policy(
            "RolloutPolicy",
            `${deployment.deploymentId}:rollout`,
            policyResourceVersion(deployment.rolloutPolicy),
          ),
        ]
      : []),
    ...(deployment.preview
      ? [
          policy(
            "PreviewPolicy",
            `${deployment.deploymentId}:preview`,
            policyResourceVersion(deployment.preview),
          ),
        ]
      : []),
    ...(deployment.smoke
      ? [
          policy(
            "SmokePolicy",
            `${deployment.deploymentId}:smoke`,
            policyResourceVersion(deployment.smoke),
          ),
        ]
      : []),
  ];
}

function readinessGatePolicies(deployment: DeploymentTarget): DeploymentPolicyResourceBinding[] {
  return (deployment.admissionPolicy.readinessGates || []).map((gate) =>
    policy(
      "ReadinessGatePolicy",
      `${deployment.deploymentId}:readiness:${gate.name}`,
      gate.gateVersion,
    ),
  );
}

function admissionExtensionPolicies(
  deployment: DeploymentTarget,
): DeploymentPolicyResourceBinding[] {
  const bindings: DeploymentPolicyResourceBinding[] = [];
  const policy = deployment.admissionPolicy;
  if (policy.attestation) {
    bindings.push(
      policyResource(
        "AttestationPolicy",
        `${deployment.deploymentId}:attestation`,
        policy.fingerprint,
      ),
    );
  }
  if (policy.sbom) {
    bindings.push(
      policyResource("SbomPolicy", `${deployment.deploymentId}:sbom`, policy.fingerprint),
    );
  }
  for (const [index] of policy.supplyChainGates.entries()) {
    bindings.push(
      policyResource(
        "SupplyChainPolicy",
        `${deployment.deploymentId}:supply-chain:${index}`,
        policy.fingerprint,
      ),
    );
  }
  return bindings;
}

function laneSourceRefPolicies(deployment: DeploymentTarget): DeploymentPolicyResourceBinding[] {
  return deployment.lanePolicy.governance.sourceRefPolicies.map((entry) =>
    policyResource(
      "SourceRefPolicy",
      `${deployment.lanePolicy.governanceRef}:${entry.stage}`,
      deployment.lanePolicy.governance.fingerprint,
    ),
  );
}

function providerCapabilityPolicy(deployment: DeploymentTarget): DeploymentPolicyResourceBinding[] {
  const capability = providerCapabilityFor(deployment.provider);
  return capability
    ? [
        policyResource(
          "ProviderCapabilityPolicy",
          `provider-capability:${capability.provider}`,
          PROVIDER_CAPABILITY_VERSION,
        ),
      ]
    : [];
}

function policy(
  kind: DeploymentResourceKind,
  resourceId: string,
  version: string,
): DeploymentPolicyResourceBinding {
  return policyResource(kind, resourceId, version);
}

function policyResource(
  kind: DeploymentResourceKind,
  resourceId: string,
  version: string,
): DeploymentPolicyResourceBinding {
  return { kind, resourceId, version };
}

function uniquePolicyBindings(
  bindings: DeploymentPolicyResourceBinding[],
): DeploymentPolicyResourceBinding[] {
  const seen = new Set<string>();
  return bindings
    .filter((binding) => {
      if (!binding.resourceId || !binding.version) return false;
      const key = `${binding.kind}\0${binding.resourceId}\0${binding.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      `${left.kind}:${left.resourceId}`.localeCompare(`${right.kind}:${right.resourceId}`),
    );
}
