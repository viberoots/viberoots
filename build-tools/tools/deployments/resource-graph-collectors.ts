#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import * as capabilities from "./resource-graph-provider-capabilities";
import {
  componentResourceId,
  deploymentRefFacts,
  deploymentRefs,
  environmentStageResourceId,
  runtimeConfigRequirementResourceId,
  secretRequirementResourceId,
} from "./resource-graph-collector-refs";
import { collectActionAndArtifactResources } from "./resource-graph-collector-actions";
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

export function collectDeploymentIntentResources(
  deployment: DeploymentTarget,
): DeploymentResourceInventoryEntry[] {
  const out: DeploymentResourceInventoryEntry[] = [];
  out.push(
    entry(
      "Deployment",
      deployment.deploymentId,
      deployment.label,
      deploymentRefs(deployment),
      deploymentRefFacts(deployment),
    ),
  );
  if (deployment.deploymentFamily) {
    out.push(
      entry("DeploymentFamily", deployment.deploymentFamily, deployment.label, [deployment.label]),
    );
  }
  const capability = capabilities.reviewedProviderCapability(deployment.provider);
  out.push(
    entry(
      "ProviderTarget",
      deployment.providerTarget.identity,
      deployment.label,
      capability ? [`provider-capability:${capability.provider}`] : [],
      {
        provider: deployment.provider,
        ...(capability ? capabilities.providerCapabilityBindingFacts(capability) : {}),
      },
    ),
  );
  out.push(
    entry(
      "EnvironmentStage",
      `${deployment.deploymentId}:${deployment.environmentStage}`,
      deployment.label,
    ),
  );
  for (const component of deployment.components) {
    out.push(
      entry("Component", componentResourceId(deployment, component.id), component.target, [], {
        kind: component.kind,
        target: component.target,
      }),
    );
  }
  out.push(
    entry(
      "LanePolicy",
      deployment.lanePolicyRef,
      deployment.lanePolicyRef,
      [deployment.lanePolicy.governanceRef],
      {
        stages: deployment.lanePolicy.stages,
        sourceRefPolicy: deployment.lanePolicy.sourceRefPolicy,
        allowedPromotionEdges: deployment.lanePolicy.allowedPromotionEdges,
        artifactReuseMode: deployment.lanePolicy.artifactReuseMode,
        promotionCompatibility: deployment.lanePolicy.promotionCompatibility,
        defaultClientProfile: deployment.lanePolicy.defaultClientProfile,
        admissionFingerprint: deployment.lanePolicy.fingerprint,
        statusVisibility: "operator_status",
      },
    ),
  );
  out.push(
    entry(
      "LaneGovernancePolicy",
      deployment.lanePolicy.governanceRef,
      deployment.lanePolicy.governanceRef,
      [],
      {
        scmBackend: deployment.lanePolicy.governance.scmBackend,
        repository: deployment.lanePolicy.governance.repository,
        sourceRefPolicies: deployment.lanePolicy.governance.sourceRefPolicies,
        trustedReporterIdentities: deployment.lanePolicy.governance.trustedReporterIdentities,
        requiredApprovalBoundaries: deployment.lanePolicy.governance.requiredApprovalBoundaries,
        admissionFingerprint: deployment.lanePolicy.governance.fingerprint,
        statusVisibility: "operator_status",
      },
    ),
  );
  out.push(
    entry("AdmissionPolicy", deployment.admissionPolicyRef, deployment.admissionPolicyRef, [], {
      allowedRefs: deployment.admissionPolicy.allowedRefs,
      requiredChecks: deployment.admissionPolicy.requiredChecks,
      requiredApprovals: deployment.admissionPolicy.requiredApprovals,
      retryBranchPolicy: deployment.admissionPolicy.retryBranchPolicy,
      retryApprovalReuse: deployment.admissionPolicy.retryApprovalReuse,
      artifactAttestationMode: deployment.admissionPolicy.artifactAttestationMode,
      supplyChainGates: deployment.admissionPolicy.supplyChainGates,
      admissionFingerprint: deployment.admissionPolicy.fingerprint,
      statusVisibility: "operator_status",
    }),
  );
  collectPolicyChildren(deployment, out);
  collectRequirements(deployment, out);
  out.push(...collectActionAndArtifactResources(deployment));
  return out;
}

function collectPolicyChildren(
  deployment: DeploymentTarget,
  out: DeploymentResourceInventoryEntry[],
): void {
  if (deployment.rolloutPolicy) {
    out.push(entry("RolloutPolicy", `${deployment.deploymentId}:rollout`, deployment.label));
  }
  if (deployment.preview)
    out.push(entry("PreviewPolicy", `${deployment.deploymentId}:preview`, deployment.label));
  if (deployment.smoke)
    out.push(entry("SmokePolicy", `${deployment.deploymentId}:smoke`, deployment.label));
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

function collectRequirements(
  deployment: DeploymentTarget,
  out: DeploymentResourceInventoryEntry[],
): void {
  for (const requirement of deployment.secretRequirements) {
    out.push(
      entry(
        "SecretRequirement",
        secretRequirementResourceId(deployment, requirement.step, requirement.name),
        deployment.label,
        [],
        {
          contractId: requirement.contractId,
          required: requirement.required,
        },
      ),
    );
  }
  for (const requirement of deployment.runtimeConfigRequirements) {
    out.push(
      entry(
        "RuntimeConfigRequirement",
        runtimeConfigRequirementResourceId(deployment, requirement.step, requirement.name),
        deployment.label,
        [],
        {
          contractId: requirement.contractId,
          required: requirement.required,
        },
      ),
    );
  }
}
