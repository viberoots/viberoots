#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../../lib/graph.ts";
import {
  DEPLOYMENT_RELEASE_ACTION_RULE,
  type DeploymentReleaseAction,
} from "../../deployments/deployment-release-actions.ts";
import type { DeploymentRequirement } from "../../deployments/deployment-requirements.ts";
import {
  DEPLOYMENT_TARGET_EXCEPTION_RULE,
  type DeploymentTargetException,
} from "../../deployments/deployment-target-exceptions.ts";

export function deploymentRequirementFixture(
  overrides: Partial<DeploymentRequirement> = {},
): DeploymentRequirement {
  return {
    name: overrides.name || "database_url",
    step: overrides.step || "release_actions.pre_publish",
    contractId: overrides.contractId || "secret://deployments/demoapp/database_url",
    required: overrides.required ?? true,
    ...(overrides.source ? { source: overrides.source } : {}),
    ...(overrides.previewVariant ? { previewVariant: overrides.previewVariant } : {}),
    ...(overrides.notes ? { notes: overrides.notes } : {}),
  };
}

export function deploymentReleaseActionFixture(
  overrides: Partial<DeploymentReleaseAction> = {},
): DeploymentReleaseAction {
  return {
    ref: overrides.ref || "//test-workspace/deployments/demoapp-shared:db_migration",
    type: overrides.type || "schema_migration",
    phase: overrides.phase || "pre_publish",
    runCondition: overrides.runCondition || "success_only",
    abortBehavior: overrides.abortBehavior || "fail_run",
    dataCompatibility: overrides.dataCompatibility || "forward_only",
    replayPolicy: overrides.replayPolicy || {
      deploy_publish_slice: "skip",
      retry: "rerun",
      rollback: "fail",
      promotion: "skip",
    },
    duplicateSafety: overrides.duplicateSafety || { retry: "control_plane_deduplicated" },
    operationKeys: overrides.operationKeys || { retry: "db-migration:${deploy_run_id}" },
    requiredSecretRequirementNames: overrides.requiredSecretRequirementNames || ["database_url"],
    requiredRuntimeConfigRequirementNames: overrides.requiredRuntimeConfigRequirementNames || [
      "schema_version",
    ],
  };
}

export function deploymentReleaseActionNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  const action = deploymentReleaseActionFixture();
  return {
    name: action.ref,
    rule_type: DEPLOYMENT_RELEASE_ACTION_RULE,
    type: action.type,
    phase: action.phase,
    run_condition: action.runCondition,
    abort_behavior: action.abortBehavior,
    data_compatibility: action.dataCompatibility,
    replay_policy: action.replayPolicy,
    duplicate_safety: action.duplicateSafety,
    operation_keys: action.operationKeys,
    required_secret_requirements: action.requiredSecretRequirementNames,
    required_runtime_config_requirements: action.requiredRuntimeConfigRequirementNames,
    ...overrides,
  };
}

export function deploymentTargetExceptionFixture(
  overrides: Partial<DeploymentTargetException> = {},
): DeploymentTargetException {
  return {
    ref: overrides.ref || "//test-workspace/deployments/demoapp-shared:alias_window",
    exceptionId: overrides.exceptionId || "alias-window",
    exceptionKind: overrides.exceptionKind || "alias",
    affectedDeploymentIds: overrides.affectedDeploymentIds || ["demoapp-dev", "demoapp-next"],
    oldProviderTargetIdentity:
      overrides.oldProviderTargetIdentity || "cloudflare-pages:web-platform-staging/demoapp-pages",
    ...(overrides.newProviderTargetIdentity
      ? { newProviderTargetIdentity: overrides.newProviderTargetIdentity }
      : {}),
    sharedLockScope:
      overrides.sharedLockScope || "cloudflare-pages:web-platform-staging/demoapp-pages",
    approvalEvidence: overrides.approvalEvidence || "RFC-123",
    effectiveAt: overrides.effectiveAt || "2026-01-01T00:00:00.000Z",
    ...(overrides.expiresAt
      ? { expiresAt: overrides.expiresAt }
      : { expiresAt: "2027-01-01T00:00:00.000Z" }),
    ...(overrides.completionSignal ? { completionSignal: overrides.completionSignal } : {}),
    reconciliationOwner: overrides.reconciliationOwner || "deployments@kilty.io",
  };
}

export function deploymentTargetExceptionNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  const exception = deploymentTargetExceptionFixture();
  return {
    name: exception.ref,
    rule_type: DEPLOYMENT_TARGET_EXCEPTION_RULE,
    exception_id: exception.exceptionId,
    exception_kind: exception.exceptionKind,
    affected_deployments: exception.affectedDeploymentIds,
    old_provider_target_identity: exception.oldProviderTargetIdentity,
    new_provider_target_identity: exception.newProviderTargetIdentity || "",
    shared_lock_scope: exception.sharedLockScope,
    approval_evidence: exception.approvalEvidence,
    effective_at: exception.effectiveAt,
    expires_at: exception.expiresAt || "",
    completion_signal: exception.completionSignal || "",
    reconciliation_owner: exception.reconciliationOwner,
    ...overrides,
  };
}
