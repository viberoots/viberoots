#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchGithubLaneGovernanceSnapshot } from "../../deployments/deployment-lane-governance-github";
import { nixosSharedHostLaneGovernanceFixture } from "./deployment-lane-governance.fixture";

function lanePolicyFixture(governance = nixosSharedHostLaneGovernanceFixture()) {
  return {
    ref: "//projects/deployments/pleomino-shared:lane",
    name: "lane",
    stages: ["dev", "staging", "prod"],
    sourceRefPolicy: {
      dev: "main",
      staging: "main",
      prod: "refs/tags/release/*",
    },
    governanceRef: governance.ref,
    allowedPromotionEdges: ["dev->staging", "staging->prod"],
    artifactReuseMode: "same_artifact",
    governance,
    fingerprint: "sha256:test-lane-policy",
  };
}

test("GitHub lane governance snapshot uses source-ref policies and approval boundaries", async () => {
  const governance = nixosSharedHostLaneGovernanceFixture({
    sourceRefPolicies: [
      { stage: "dev", allowedRefs: ["main"], requiredChecks: ["deploy/dev"] },
      {
        stage: "staging",
        allowedRefs: ["main", "refs/tags/release/*"],
        requiredChecks: ["deploy/staging"],
      },
      {
        stage: "prod",
        allowedRefs: ["refs/tags/release/*"],
        requiredChecks: ["deploy/prod"],
      },
    ],
    trustedReporterIdentities: ["app:deploy-bot", "ci:jenkins"],
    requiredApprovalBoundaries: [
      { stage: "staging", requiredApprovals: ["release-owner"] },
      { stage: "prod", requiredApprovals: ["release-owner", "security-owner"] },
    ],
  });

  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("source-ref governance snapshots must not query branch protections");
  }) as typeof fetch;
  try {
    const snapshot = await fetchGithubLaneGovernanceSnapshot({
      lanePolicy: lanePolicyFixture(governance),
      env: { VBR_DEPLOY_GITHUB_TOKEN: "ghp_test" } as NodeJS.ProcessEnv,
    });

    assert.equal(snapshot.scmBackend, "github");
    assert.equal(snapshot.repository, governance.repository);
    assert.deepEqual(snapshot.sourceRefPolicies, governance.sourceRefPolicies);
    assert.deepEqual(snapshot.trustedReporterIdentities, governance.trustedReporterIdentities);
    assert.deepEqual(snapshot.requiredApprovalBoundaries, governance.requiredApprovalBoundaries);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
