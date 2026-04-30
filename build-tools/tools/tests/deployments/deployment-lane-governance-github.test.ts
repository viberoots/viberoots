#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchGithubLaneGovernanceSnapshot } from "../../deployments/deployment-lane-governance-github.ts";
import { nixosSharedHostLaneGovernanceFixture } from "./deployment-lane-governance.fixture.ts";

type FetchCall = {
  owner: string;
  name: string;
  branch: string;
};

function githubWildcardRule(branch: string) {
  return {
    pattern: "env/*/*",
    allowsForcePushes: false,
    requiresLinearHistory: true,
    requiredStatusCheckContexts: ["deploy/admission"],
    matchingRefs: { nodes: [{ name: branch }] },
    pushAllowances: { nodes: [{ actor: { __typename: "App", slug: "deploy-bot" } }] },
    bypassPullRequestAllowances: { nodes: [] },
    bypassForcePushAllowances: {
      nodes: [{ actor: { __typename: "Team", slug: "sre-break-glass" } }],
    },
  };
}

function githubWildcardRuleset() {
  return {
    name: "deployment",
    target: "BRANCH",
    enforcement: "ACTIVE",
    conditions: {
      refName: {
        include: ["refs/heads/env/**/*"],
        exclude: [],
      },
    },
    bypassActors: {
      nodes: [
        {
          bypassMode: "ALWAYS",
          deployKey: false,
          enterpriseOwner: false,
          enterpriseRole: false,
          organizationAdmin: false,
          repositoryRoleName: "admin",
          actor: null,
        },
      ],
    },
    rules: {
      nodes: [
        { type: "REQUIRED_LINEAR_HISTORY", parameters: null },
        { type: "NON_FAST_FORWARD", parameters: null },
        {
          type: "REQUIRED_STATUS_CHECKS",
          parameters: {
            __typename: "RequiredStatusChecksParameters",
            requiredStatusChecks: [{ context: "deploy/admission" }],
          },
        },
      ],
    },
  };
}

test("GitHub wildcard branch protection rule can verify every declared branch", async () => {
  const calls: FetchCall[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push(body.variables);
    return new Response(
      JSON.stringify({
        data: {
          repository: {
            branchProtectionRules: {
              nodes: [githubWildcardRule(body.variables.branch)],
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const governance = nixosSharedHostLaneGovernanceFixture({
      branchProtections: ["dev", "staging", "prod"].map((stage) => ({
        stage,
        branch: `env/pleomino/${stage}`,
        requiredChecks: ["deploy/admission"],
        fastForwardOnly: true,
        normalAdvancePrincipals: ["app:deploy-bot"],
        emergencyDirectPushPrincipals: ["team:sre-break-glass"],
      })),
    });
    const snapshot = await fetchGithubLaneGovernanceSnapshot({
      lanePolicy: {
        ref: "//projects/deployments/pleomino-shared:lane",
        name: "lane",
        stages: ["dev", "staging", "prod"],
        governanceRef: governance.ref,
        stageBranches: {
          dev: "env/pleomino/dev",
          staging: "env/pleomino/staging",
          prod: "env/pleomino/prod",
        },
        allowedPromotionEdges: ["dev->staging", "staging->prod"],
        artifactReuseMode: "same_artifact",
        governance,
        fingerprint: "sha256:test-lane-policy",
      },
      env: { BNX_DEPLOY_GITHUB_TOKEN: "ghp_test" } as NodeJS.ProcessEnv,
    });
    assert.deepEqual(calls.map((call) => call.branch).sort(), [
      "env/pleomino/dev",
      "env/pleomino/prod",
      "env/pleomino/staging",
    ]);
    assert.deepEqual(
      snapshot.branchProtections.map((entry) => ({
        stage: entry.stage,
        branch: entry.branch,
        requiredChecks: entry.requiredChecks,
        fastForwardOnly: entry.fastForwardOnly,
        normalAdvancePrincipals: entry.normalAdvancePrincipals,
        emergencyDirectPushPrincipals: entry.emergencyDirectPushPrincipals,
      })),
      governance.branchProtections,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("GitHub repository ruleset can verify every declared branch", async () => {
  const calls: FetchCall[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push(body.variables);
    return new Response(
      JSON.stringify({
        data: {
          repository: {
            branchProtectionRules: {
              nodes: [],
            },
            rulesets: {
              nodes: [githubWildcardRuleset()],
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const governance = nixosSharedHostLaneGovernanceFixture({
      branchProtections: ["dev", "staging", "prod"].map((stage) => ({
        stage,
        branch: `env/pleomino/${stage}`,
        requiredChecks: ["deploy/admission"],
        fastForwardOnly: true,
        normalAdvancePrincipals: ["repository-role:admin"],
        emergencyDirectPushPrincipals: ["repository-role:admin"],
      })),
    });
    const snapshot = await fetchGithubLaneGovernanceSnapshot({
      lanePolicy: {
        ref: "//projects/deployments/pleomino-shared:lane",
        name: "lane",
        stages: ["dev", "staging", "prod"],
        governanceRef: governance.ref,
        stageBranches: {
          dev: "env/pleomino/dev",
          staging: "env/pleomino/staging",
          prod: "env/pleomino/prod",
        },
        allowedPromotionEdges: ["dev->staging", "staging->prod"],
        artifactReuseMode: "same_artifact",
        governance,
        fingerprint: "sha256:test-lane-policy",
      },
      env: { BNX_DEPLOY_GITHUB_TOKEN: "ghp_test" } as NodeJS.ProcessEnv,
    });
    assert.deepEqual(calls.map((call) => call.branch).sort(), [
      "env/pleomino/dev",
      "env/pleomino/prod",
      "env/pleomino/staging",
    ]);
    assert.deepEqual(
      snapshot.branchProtections.map((entry) => ({
        stage: entry.stage,
        branch: entry.branch,
        requiredChecks: entry.requiredChecks,
        fastForwardOnly: entry.fastForwardOnly,
        normalAdvancePrincipals: entry.normalAdvancePrincipals,
        emergencyDirectPushPrincipals: entry.emergencyDirectPushPrincipals,
      })),
      governance.branchProtections,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
