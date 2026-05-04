import type { DeploymentTargetException } from "../../deployments/contract";
import type { DeploymentReleaseAction } from "../../deployments/deployment-release-actions";
import type {
  DeploymentAdmissionPolicy,
  DeploymentLanePolicy,
} from "../../deployments/deployment-policy";
import { labelName } from "./deployment-targets.install.fragments";
import { renderStringList, renderStringRecordList } from "./deployment-targets.install.render";

export function renderPromotionCompatibility(policy: DeploymentLanePolicy): string | undefined {
  const edges = policy.promotionCompatibility?.crossProviderPromotionEdges;
  if (!edges || edges.length === 0) return undefined;
  return JSON.stringify({ cross_provider_promotion_edges: edges });
}

export function renderAdmissionPolicy(
  policyRef: string,
  policy: DeploymentAdmissionPolicy,
): string[] {
  return [
    "deployment_admission_policy(",
    `    name = ${JSON.stringify(labelName(policyRef))},`,
    `    allowed_refs = ${renderStringList(policy.allowedRefs)},`,
    `    required_checks = ${renderStringList(policy.requiredChecks)},`,
    `    required_approvals = ${renderStringList(policy.requiredApprovals)},`,
    ...[
      "    readiness_gates =",
      ...renderStringRecordList(
        (policy.readinessGates || []).map((gate) => ({
          name: gate.name,
          type: gate.type,
          required_for: gate.requiredFor.join(","),
        })),
      ),
    ],
    `    retry_branch_policy = ${JSON.stringify(policy.retryBranchPolicy)},`,
    `    retry_approval_reuse = ${JSON.stringify(policy.retryApprovalReuse)},`,
    `    artifact_attestation_mode = ${JSON.stringify(policy.artifactAttestationMode)},`,
    `    trusted_builder_identities = ${renderStringList(
      policy.attestation?.trustedBuilderIdentities || [],
    )},`,
    `    accepted_provenance_formats = ${renderStringList(
      policy.attestation?.acceptedProvenanceFormats || [],
    )},`,
    `    artifact_binding = ${JSON.stringify(policy.attestation?.artifactBinding || "")},`,
    `    expired_attestation_behavior = ${JSON.stringify(
      policy.attestation?.expiredBehavior || "",
    )},`,
    `    revoked_attestation_behavior = ${JSON.stringify(
      policy.attestation?.revokedBehavior || "",
    )},`,
    `    attestation_trust_drift_behavior = ${JSON.stringify(
      policy.attestation?.trustDriftBehavior || "",
    )},`,
    `    require_artifact_signatures = ${
      policy.attestation?.signatureRequired ? "True" : "False"
    },`,
    `    trusted_signer_identities = ${renderStringList(
      policy.attestation?.trustedSignerIdentities || [],
    )},`,
    `    sbom_required = ${policy.sbom?.required ? "True" : "False"},`,
    `    accepted_sbom_formats = ${renderStringList(policy.sbom?.acceptedFormats || [])},`,
    ...[
      "    supply_chain_gates =",
      ...renderStringRecordList(
        (policy.supplyChainGates || []).map((gate) =>
          Object.fromEntries(Object.entries(gate).map(([key, value]) => [key, String(value)])),
        ),
      ),
    ],
    '    visibility = ["PUBLIC"],',
    ")",
    "",
  ];
}

export function renderReleaseAction(action: DeploymentReleaseAction): string[] {
  return [
    "deployment_release_action(",
    `    name = ${JSON.stringify(labelName(action.ref))},`,
    `    type = ${JSON.stringify(action.type)},`,
    `    phase = ${JSON.stringify(action.phase)},`,
    `    run_condition = ${JSON.stringify(action.runCondition)},`,
    `    abort_behavior = ${JSON.stringify(action.abortBehavior)},`,
    `    data_compatibility = ${JSON.stringify(action.dataCompatibility)},`,
    "    replay_policy = {",
    ...Object.entries(action.replayPolicy).map(
      ([key, value]) => `        ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    ),
    "    },",
    "    duplicate_safety = {",
    ...Object.entries(action.duplicateSafety).map(
      ([key, value]) => `        ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    ),
    "    },",
    "    operation_keys = {",
    ...Object.entries(action.operationKeys).map(
      ([key, value]) => `        ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    ),
    "    },",
    `    required_secret_requirements = ${renderStringList(
      action.requiredSecretRequirementNames,
    )},`,
    `    required_runtime_config_requirements = ${renderStringList(
      action.requiredRuntimeConfigRequirementNames,
    )},`,
    '    visibility = ["PUBLIC"],',
    ")",
    "",
  ];
}

export function renderTargetException(exception: DeploymentTargetException): string[] {
  return [
    "deployment_target_exception(",
    `    name = ${JSON.stringify(labelName(exception.ref))},`,
    `    exception_id = ${JSON.stringify(exception.exceptionId)},`,
    `    exception_kind = ${JSON.stringify(exception.exceptionKind)},`,
    `    affected_deployments = ${renderStringList(exception.affectedDeploymentIds)},`,
    `    old_provider_target_identity = ${JSON.stringify(exception.oldProviderTargetIdentity)},`,
    `    new_provider_target_identity = ${JSON.stringify(
      exception.newProviderTargetIdentity || "",
    )},`,
    `    shared_lock_scope = ${JSON.stringify(exception.sharedLockScope)},`,
    `    approval_evidence = ${JSON.stringify(exception.approvalEvidence)},`,
    `    effective_at = ${JSON.stringify(exception.effectiveAt)},`,
    `    expires_at = ${JSON.stringify(exception.expiresAt || "")},`,
    `    completion_signal = ${JSON.stringify(exception.completionSignal || "")},`,
    `    reconciliation_owner = ${JSON.stringify(exception.reconciliationOwner)},`,
    '    visibility = ["PUBLIC"],',
    ")",
    "",
  ];
}
