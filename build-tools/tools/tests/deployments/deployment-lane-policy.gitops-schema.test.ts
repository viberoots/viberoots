#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../lib/graph";
import { extractDeploymentLaneGovernancePolicies } from "../../deployments/deployment-lane-governance";
import {
  extractDeploymentLanePoliciesWithGovernance,
  extractDeploymentAdmissionPolicies,
  type DeploymentAdmissionPolicy,
} from "../../deployments/deployment-policy";
import { resolveSharedDeploymentPolicies } from "../../deployments/deployment-policy-binding";

function governanceNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/app-shared:lane_governance",
    rule_type: "deployment_lane_governance",
    scm_backend: "github",
    repository: "viberoots/viberoots",
    source_ref_policies: [
      { stage: "dev", allowed_refs: "main", required_checks: "deploy/admission" },
      {
        stage: "staging",
        allowed_refs: "main,refs/tags/release/*",
        required_checks: "deploy/admission",
      },
      {
        stage: "prod",
        allowed_refs: "refs/tags/release/*",
        required_checks: "deploy/admission",
      },
    ],
    trusted_reporter_identities: ["app:deploy-bot", "ci:jenkins"],
    required_approval_boundaries: [{ stage: "prod", required_approvals: "release-owner" }],
    ...overrides,
  };
}

function laneNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/app-shared:lane",
    rule_type: "deployment_lane_policy",
    stages: ["dev", "staging", "prod"],
    source_ref_policy: {
      dev: "main",
      staging: "main",
      prod: "refs/tags/release/*",
    },
    allowed_promotion_edges: ["dev->staging", "staging->prod"],
    artifact_reuse_mode: "same_artifact",
    promotion_compatibility: JSON.stringify({ cross_provider_promotion_edges: ["dev->staging"] }),
    governance_policy: "//projects/deployments/app-shared:lane_governance",
    ...overrides,
  };
}

test("lane policies extract git-backed governance without stage branches", () => {
  const governance = extractDeploymentLaneGovernancePolicies([governanceNode()]);
  assert.deepEqual(governance.errors, []);
  const result = extractDeploymentLanePoliciesWithGovernance([laneNode()], governance.policies);
  assert.deepEqual(result.errors, []);
  const lane = result.policies.get("//projects/deployments/app-shared:lane");
  assert.ok(lane);
  assert.deepEqual(lane.stages, ["dev", "staging", "prod"]);
  assert.deepEqual(lane.stageBranches, {});
  assert.deepEqual(lane.sourceRefPolicy, {
    dev: "main",
    staging: "main",
    prod: "refs/tags/release/*",
  });
  assert.deepEqual(lane.allowedPromotionEdges, ["dev->staging", "staging->prod"]);
  assert.equal(lane.artifactReuseMode, "same_artifact");
  assert.deepEqual(lane.governance.trustedReporterIdentities, ["app:deploy-bot", "ci:jenkins"]);
  assert.deepEqual(lane.governance.requiredApprovalBoundaries, [
    { stage: "prod", requiredApprovals: ["release-owner"] },
  ]);
});

test("lane policies reject stale stage branch promotion state", () => {
  const governance = extractDeploymentLaneGovernancePolicies([governanceNode()]);
  const result = extractDeploymentLanePoliciesWithGovernance(
    [
      laneNode({
        source_ref_policy: { dev: "main" },
        stage_branches: { dev: "env/app/dev" },
        stage_branches_required: true,
      }),
    ],
    governance.policies,
  );
  assert.match(result.errors.join("\n"), /stage_branches is not supported/);
});

test("lane policies reject required stage branches even without a branch mapping", () => {
  const governance = extractDeploymentLaneGovernancePolicies([governanceNode()]);
  const result = extractDeploymentLanePoliciesWithGovernance(
    [laneNode({ source_ref_policy: { dev: "main" }, stage_branches_required: true })],
    governance.policies,
  );
  assert.match(result.errors.join("\n"), /stage_branches_required is not supported/);
});

test("lane policies reject environment branches in source-ref policy", () => {
  const governance = extractDeploymentLaneGovernancePolicies([
    governanceNode({
      source_ref_policies: [
        { stage: "prod", allowed_refs: "env/app/prod", required_checks: "deploy/admission" },
      ],
    }),
  ]);
  assert.match(governance.errors.join("\n"), /must not use environment branch env\/app\/prod/);

  const validGovernance = extractDeploymentLaneGovernancePolicies([governanceNode()]);
  const lanes = extractDeploymentLanePoliciesWithGovernance(
    [laneNode({ source_ref_policy: { dev: "main", staging: "main", prod: "env/app/prod" } })],
    validGovernance.policies,
  );
  assert.match(lanes.errors.join("\n"), /source_ref_policy must not use environment branch/);
});

test("admission policies reject environment branches in allowed refs", () => {
  const policies = extractDeploymentAdmissionPolicies([
    {
      name: "//projects/deployments/app-shared:prod_release",
      rule_type: "deployment_admission_policy",
      allowed_refs: ["env/app/prod"],
      required_checks: ["deploy/admission"],
    },
  ]);
  assert.match(policies.errors.join("\n"), /allowed_refs must not use environment branch/);
});

test("lane governance rejects missing trusted reporters and approval boundaries", () => {
  const governance = extractDeploymentLaneGovernancePolicies([
    governanceNode({
      trusted_reporter_identities: [],
      required_approval_boundaries: [],
    }),
  ]);
  assert.match(governance.errors.join("\n"), /must define trusted_reporter_identities/);
  assert.match(governance.errors.join("\n"), /must define required_approval_boundaries/);
});

test("lane policy binding enforces governance approval boundaries", () => {
  const governance = extractDeploymentLaneGovernancePolicies([governanceNode()]);
  const lanes = extractDeploymentLanePoliciesWithGovernance([laneNode()], governance.policies);
  const lane = lanes.policies.get("//projects/deployments/app-shared:lane");
  assert.ok(lane);
  const admissionPolicy: DeploymentAdmissionPolicy = {
    ref: "//projects/deployments/app-shared:prod_release",
    name: "prod_release",
    allowedRefs: ["refs/tags/release/*"],
    requiredChecks: ["deploy/admission"],
    requiredApprovals: [],
    retryBranchPolicy: "branch_independent",
    retryApprovalReuse: "fresh_only",
    artifactAttestationMode: "recorded_exact_artifact",
    supplyChainGates: [],
    fingerprint: "sha256:prod-release",
  };
  const errors: string[] = [];
  resolveSharedDeploymentPolicies({
    context: {
      nodes: [],
      components: new Map(),
      lanePolicies: new Map([[lane.ref, lane]]),
      admissionPolicies: new Map([[admissionPolicy.ref, admissionPolicy]]),
      releaseActions: new Map(),
      targetExceptions: new Map(),
      errors: [],
    },
    label: "//projects/deployments/app-prod:deploy",
    lanePolicyRef: lane.ref,
    admissionPolicyRef: admissionPolicy.ref,
    environmentStage: "prod",
    errors,
  });
  assert.match(errors.join("\n"), /required_approvals must include governance boundary/);
  assert.match(errors.join("\n"), /release-owner/);
});
