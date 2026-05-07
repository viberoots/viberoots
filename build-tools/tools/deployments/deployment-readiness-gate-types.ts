#!/usr/bin/env zx-wrapper
import type { DeploymentAdmissionOperationKind } from "./deployment-admission-binding";

export type DeploymentReadinessGateType =
  | "ragie_acl_semantics"
  | "tenant_leak_check"
  | "workos_mcp_auth"
  | "storage_grant_lifecycle"
  | "fetch_full_document_grant_lifecycle"
  | "connect_metadata_shape"
  | "connect_oauth_flow"
  | "connect_source_update"
  | "scoped_source_enforcement"
  | "connect_branding_observation"
  | "connect_limitation_decision"
  | "connect_acl_review"
  | "github_selected_repository_install"
  | "github_permissions"
  | "github_token_hygiene"
  | "github_refresh_semantics"
  | "github_retrieval_bakeoff"
  | "external_source_fetch_full_document_denial"
  | "connect_metadata_oauth";

export type DeploymentAdmissionAccessMode =
  | "direct_upload_pilot"
  | "connector_demo"
  | "connector_internal";

export type DeploymentReadinessGatePolicy = {
  name: string;
  type: DeploymentReadinessGateType;
  requiredFor: DeploymentAdmissionOperationKind[];
  requiredAccess?: DeploymentAdmissionAccessMode[];
  gateVersion: string;
  source?: string;
  client?: string;
  policyCombination?: string;
  credentialContractId?: string;
  credentialSource?: "secret_runtime";
  secretRuntimeStep?: string;
};

export type DeploymentReadinessGateDiagnostics = {
  summary: string;
  reviewContextRef?: string;
};

export type DeploymentReadinessGateEvidence = {
  name: string;
  type: DeploymentReadinessGateType;
  status: "passed" | "failed";
  checkedAt: string;
  expiresAt?: string;
  gateVersion: string;
  deploymentId: string;
  environmentStage: string;
  providerTargetIdentity: string;
  source?: string;
  client?: string;
  policyCombination?: string;
  sourceRevision?: string;
  sourceRunId?: string;
  evidenceRef: string;
  redactedSummary: string;
  diagnostics: DeploymentReadinessGateDiagnostics;
};

export type DeploymentReadinessGateFact = DeploymentReadinessGateEvidence & {
  status: "passed";
};

export const DEPLOYMENT_READINESS_GATE_TYPES: DeploymentReadinessGateType[] = [
  "ragie_acl_semantics",
  "tenant_leak_check",
  "workos_mcp_auth",
  "storage_grant_lifecycle",
  "fetch_full_document_grant_lifecycle",
  "connect_metadata_shape",
  "connect_oauth_flow",
  "connect_source_update",
  "scoped_source_enforcement",
  "connect_branding_observation",
  "connect_limitation_decision",
  "connect_acl_review",
  "github_selected_repository_install",
  "github_permissions",
  "github_token_hygiene",
  "github_refresh_semantics",
  "github_retrieval_bakeoff",
  "external_source_fetch_full_document_denial",
  "connect_metadata_oauth",
];

export const DEPLOYMENT_ADMISSION_ACCESS_MODES = [
  "direct_upload_pilot",
  "connector_demo",
  "connector_internal",
];
