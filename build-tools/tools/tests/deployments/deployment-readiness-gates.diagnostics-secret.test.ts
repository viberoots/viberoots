#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAdmissionEvidence } from "../../deployments/deployment-admission-evidence";
import { extractDeploymentAdmissionPolicies } from "../../deployments/deployment-policy";

const BASE_EVIDENCE = {
  type: "workos_mcp_auth",
  status: "passed",
  checkedAt: "2026-05-03T12:00:00.000Z",
  gateVersion: "phase0-2026-05",
  deploymentId: "console-staging",
  environmentStage: "staging",
  providerTargetIdentity: "vercel:web/console#staging",
};

test("normalization preserves redacted diagnostics and drops raw diagnostics", () => {
  const normalized = normalizeAdmissionEvidence({
    readinessGates: [
      {
        ...BASE_EVIDENCE,
        name: "workos/mcp",
        evidenceRef: "evidence://workos/mcp",
        redactedSummary: "reviewed clients authenticated",
        diagnostics: {
          summary: "claude, chatgpt, cursor authenticated",
          reviewContextRef: "evidence://workos/mcp/review",
        },
      },
      {
        ...BASE_EVIDENCE,
        name: "workos/raw",
        evidenceRef: "evidence://workos/raw",
        redactedSummary: "raw diagnostics present",
        diagnostics: { summary: "bad", rawDiagnostics: ["secret-bearing trace"] },
      },
    ],
  });
  assert.equal(normalized?.readinessGates?.length, 1);
  assert.deepEqual(normalized?.readinessGates?.[0]?.diagnostics, {
    summary: "claude, chatgpt, cursor authenticated",
    reviewContextRef: "evidence://workos/mcp/review",
  });
});

test("normalization requires redacted summary and diagnostics", () => {
  const normalized = normalizeAdmissionEvidence({
    readinessGates: [
      {
        ...BASE_EVIDENCE,
        name: "workos/no-diagnostics",
        evidenceRef: "evidence://workos/no-diagnostics",
        redactedSummary: "summary without diagnostics",
      },
      {
        ...BASE_EVIDENCE,
        name: "workos/no-summary",
        evidenceRef: "evidence://workos/no-summary",
        diagnostics: { summary: "diagnostics without summary" },
      },
    ],
  });
  assert.equal(normalized?.readinessGates, undefined);
});

test("normalization drops readiness evidence with provider payloads", () => {
  const normalized = normalizeAdmissionEvidence({
    readinessGates: [
      {
        ...BASE_EVIDENCE,
        name: "workos/mcp",
        evidenceRef: "evidence://workos/mcp",
        providerResponse: { token: "must-not-serialize" },
      },
    ],
  });
  assert.equal(normalized?.readinessGates, undefined);
});

test("normalization drops readiness evidence with forbidden MCP source fields", () => {
  const normalized = normalizeAdmissionEvidence({
    readinessGates: [
      {
        ...BASE_EVIDENCE,
        name: "workos/mcp",
        evidenceRef: "evidence://workos/mcp",
        metadata: { rawForensics: ["must-not-serialize"] },
      },
    ],
  });
  assert.equal(normalized?.readinessGates, undefined);
});

test("policy extraction rejects live gate credentials outside secret runtime", () => {
  const result = extractDeploymentAdmissionPolicies([
    {
      name: "//projects/deployments/shared:prod_release",
      rule_type: "deployment_admission_policy",
      allowed_refs: ["refs/tags/release/*"],
      readiness_gates: [
        {
          name: "bad/live-gate",
          type: "unknown_gate",
          required_for: "deploy,unknown_operation",
          required_access: "unknown_access",
          credential_contract_id: "secret://phase0/live-gate",
          credential_source: "env",
        },
      ],
    },
  ]);
  assert.equal(result.policies.size, 0);
  assert.ok(result.errors.some((entry) => entry.includes('unsupported type "unknown_gate"')));
  assert.ok(result.errors.some((entry) => entry.includes("credentials must use secret_runtime")));
  assert.ok(result.errors.some((entry) => entry.includes("must set secret_runtime_step")));
});

test("policy extraction accepts reviewed secret-runtime gate credentials", () => {
  const result = extractDeploymentAdmissionPolicies([
    {
      name: "//projects/deployments/shared:prod_release",
      rule_type: "deployment_admission_policy",
      allowed_refs: ["refs/tags/release/*"],
      readiness_gates: [
        {
          name: "phase0/github-refresh",
          type: "github_refresh_semantics",
          required_for: "deploy",
          gate_version: "phase0-2026-05",
          source: "github",
          credential_contract_id: "secret://deployments/phase0/github-app",
          credential_source: "secret_runtime",
          secret_runtime_step: "readiness",
        },
      ],
    },
  ]);
  assert.deepEqual(result.errors, []);
  const gate = result.policies.get("//projects/deployments/shared:prod_release")
    ?.readinessGates?.[0];
  assert.equal(gate?.credentialSource, "secret_runtime");
  assert.equal(gate?.secretRuntimeStep, "readiness");
});
