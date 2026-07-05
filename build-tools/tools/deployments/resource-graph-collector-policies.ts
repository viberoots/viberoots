#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { policyResourceVersion } from "./deployment-policy-resources";
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

export function collectPolicyChildren(
  deployment: DeploymentTarget,
  out: DeploymentResourceInventoryEntry[],
): void {
  if (deployment.rolloutPolicy) {
    out.push(
      entry("RolloutPolicy", `${deployment.deploymentId}:rollout`, deployment.label, [], {
        policyResourceVersion: policyResourceVersion(deployment.rolloutPolicy),
        statusVisibility: "operator_status",
      }),
    );
  }
  if (deployment.preview) {
    out.push(
      entry("PreviewPolicy", `${deployment.deploymentId}:preview`, deployment.label, [], {
        policyResourceVersion: policyResourceVersion(deployment.preview),
        statusVisibility: "operator_status",
      }),
    );
  }
  if (deployment.smoke) {
    out.push(
      entry("SmokePolicy", `${deployment.deploymentId}:smoke`, deployment.label, [], {
        policyResourceVersion: policyResourceVersion(deployment.smoke),
        statusVisibility: "operator_status",
      }),
    );
  }
  for (const gate of deployment.admissionPolicy.readinessGates || []) {
    out.push(
      entry(
        "ReadinessGatePolicy",
        `${deployment.deploymentId}:readiness:${gate.name}`,
        deployment.label,
      ),
    );
  }
  if (deployment.admissionPolicy.attestation) {
    out.push(
      entry("AttestationPolicy", `${deployment.deploymentId}:attestation`, deployment.label),
    );
  }
  if (deployment.admissionPolicy.sbom) {
    out.push(entry("SbomPolicy", `${deployment.deploymentId}:sbom`, deployment.label));
  }
  for (const [index] of deployment.admissionPolicy.supplyChainGates.entries()) {
    out.push(
      entry(
        "SupplyChainPolicy",
        `${deployment.deploymentId}:supply-chain:${index}`,
        deployment.label,
      ),
    );
  }
  for (const sourceRef of deployment.lanePolicy.governance.sourceRefPolicies) {
    out.push(
      entry(
        "SourceRefPolicy",
        `${deployment.lanePolicy.governanceRef}:${sourceRef.stage}`,
        deployment.lanePolicy.governanceRef,
        [deployment.lanePolicy.governanceRef],
        {
          stage: sourceRef.stage,
          allowedRefs: sourceRef.allowedRefs,
          requiredChecks: sourceRef.requiredChecks,
          trustedReporterIdentities: deployment.lanePolicy.governance.trustedReporterIdentities,
        },
      ),
    );
  }
}
