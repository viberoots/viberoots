#!/usr/bin/env zx-wrapper
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import type {
  DeploymentAdmissionAccessMode,
  DeploymentReadinessGatePolicy,
  DeploymentReadinessGateType,
} from "../../deployments/deployment-readiness-gates";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

const VERSION = "phase0-2026-05";
const CLIENTS = ["claude", "chatgpt", "cursor"];
const CONNECT_SOURCES = ["drive", "notion", "slack"];
const SCOPED_SOURCES = [...CONNECT_SOURCES, "github"];
const DENIAL_POLICIES = ["connect_allow_github_deny", "connect_deny_github_allow", "deny_all"];

function gate(opts: {
  name: string;
  type: DeploymentReadinessGateType;
  access?: DeploymentAdmissionAccessMode[];
  source?: string;
  client?: string;
  policyCombination?: string;
}): DeploymentReadinessGatePolicy {
  return {
    name: opts.name,
    type: opts.type,
    requiredFor: ["deploy"],
    gateVersion: VERSION,
    ...(opts.access ? { requiredAccess: opts.access } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.client ? { client: opts.client } : {}),
    ...(opts.policyCombination ? { policyCombination: opts.policyCombination } : {}),
  };
}

export const DIRECT_UPLOAD_GATES = [
  gate({
    name: "phase0/ragie-acl",
    type: "ragie_acl_semantics",
    access: ["direct_upload_pilot", "connector_demo"],
  }),
  gate({
    name: "phase0/tenant-leak",
    type: "tenant_leak_check",
    access: ["direct_upload_pilot", "connector_demo"],
  }),
  gate({
    name: "phase0/fetch-full-document-grant",
    type: "fetch_full_document_grant_lifecycle",
    access: ["direct_upload_pilot", "connector_demo"],
  }),
  ...CLIENTS.map((client) =>
    gate({
      name: `phase0/workos-mcp-auth/${client}`,
      type: "workos_mcp_auth",
      access: ["direct_upload_pilot", "connector_demo"],
      client,
    }),
  ),
];

export const GATE5 = [
  gate({
    name: "phase0/connect-metadata",
    type: "connect_metadata_shape",
    access: ["connector_demo"],
    source: "connect",
  }),
  gate({
    name: "phase0/connect-source-update",
    type: "connect_source_update",
    access: ["connector_demo"],
    policyCombination: "window_a_or_paused_after_import",
  }),
  gate({
    name: "phase0/connect-branding",
    type: "connect_branding_observation",
    access: ["connector_demo"],
    source: "connect",
  }),
  gate({
    name: "phase0/connect-acl-review",
    type: "connect_acl_review",
    access: ["connector_demo"],
    source: "connect",
  }),
  ...CONNECT_SOURCES.map((source) =>
    gate({
      name: `phase0/connect-oauth/${source}`,
      type: "connect_oauth_flow",
      access: ["connector_demo"],
      source,
    }),
  ),
  ...SCOPED_SOURCES.map((source) =>
    gate({
      name: `phase0/scoped-source/${source}`,
      type: "scoped_source_enforcement",
      access: ["connector_demo"],
      source,
    }),
  ),
  gate({
    name: "phase0/connect-limitations/slack",
    type: "connect_limitation_decision",
    access: ["connector_demo"],
    source: "slack",
    policyCombination: "single_channel",
  }),
  gate({
    name: "phase0/connect-limitations/notion",
    type: "connect_limitation_decision",
    access: ["connector_demo"],
    source: "notion",
    policyCombination: "workspace_token",
  }),
  gate({
    name: "phase0/github-install",
    type: "github_selected_repository_install",
    access: ["connector_demo"],
    source: "github",
  }),
  gate({
    name: "phase0/github-permissions",
    type: "github_permissions",
    access: ["connector_demo"],
    source: "github",
  }),
  gate({
    name: "phase0/github-token-non-persistence",
    type: "github_token_hygiene",
    access: ["connector_demo"],
    source: "github",
    policyCombination: "token_non_persistence",
  }),
  gate({
    name: "phase0/github-hygiene",
    type: "github_token_hygiene",
    access: ["connector_demo"],
    source: "github",
    policyCombination: "hygiene",
  }),
  gate({
    name: "phase0/github-refresh",
    type: "github_refresh_semantics",
    access: ["connector_demo"],
    source: "github",
  }),
  gate({
    name: "phase0/github-retrieval-bakeoff",
    type: "github_retrieval_bakeoff",
    access: ["connector_demo"],
    source: "github",
  }),
  ...SCOPED_SOURCES.flatMap((source) =>
    DENIAL_POLICIES.map((policyCombination) =>
      gate({
        name: `phase0/external-fetch-denial/${source}/${policyCombination}`,
        type: "external_source_fetch_full_document_denial",
        access: ["connector_demo"],
        source,
        policyCombination,
      }),
    ),
  ),
];

function deployment() {
  return nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      readinessGates: [...DIRECT_UPLOAD_GATES, ...GATE5],
    },
  });
}

function evidenceFor(deploy: ReturnType<typeof deployment>, policy: DeploymentReadinessGatePolicy) {
  return {
    name: policy.name,
    type: policy.type,
    status: "passed" as const,
    checkedAt: "2026-05-03T12:00:00.000Z",
    gateVersion: policy.gateVersion,
    deploymentId: deploy.deploymentId,
    environmentStage: deploy.environmentStage,
    providerTargetIdentity: deploy.providerTarget.deploymentTargetIdentity,
    sourceRevision: "rev-1",
    evidenceRef: `evidence://${policy.name}`,
    redactedSummary: `${policy.name} passed`,
    diagnostics: {
      summary: "redacted pass summary",
      reviewContextRef: `evidence://${policy.name}/review`,
    },
    ...(policy.source ? { source: policy.source } : {}),
    ...(policy.client ? { client: policy.client } : {}),
    ...(policy.policyCombination ? { policyCombination: policy.policyCombination } : {}),
  };
}

export async function evaluateConnectorDemo(missingName?: string) {
  const deploy = deployment();
  const admittedContext = admittedContextFixture(deploy, { sourceRevision: "rev-1" });
  return evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment: deploy,
      operationKind: "deploy",
      admittedContext,
      evidence: {
        ...reviewedLaneAdmissionEvidenceFixture({ deployment: deploy }),
        accessMode: "connector_demo",
        readinessGates: [...DIRECT_UPLOAD_GATES, ...GATE5]
          .filter((entry) => entry.name !== missingName)
          .map((entry) => evidenceFor(deploy, entry)),
      },
    }),
  });
}

export async function evaluateDirectUpload() {
  const deploy = deployment();
  const admittedContext = admittedContextFixture(deploy, { sourceRevision: "rev-1" });
  return evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment: deploy,
      operationKind: "deploy",
      admittedContext,
      evidence: {
        ...reviewedLaneAdmissionEvidenceFixture({ deployment: deploy }),
        accessMode: "direct_upload_pilot",
        readinessGates: DIRECT_UPLOAD_GATES.map((entry) => evidenceFor(deploy, entry)),
      },
    }),
  });
}
