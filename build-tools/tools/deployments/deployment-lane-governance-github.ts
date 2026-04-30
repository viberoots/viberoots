#!/usr/bin/env zx-wrapper
import type { DeploymentLaneGovernanceSnapshot } from "./deployment-admission-governance.ts";
import type { DeploymentLanePolicy } from "./deployment-policy.ts";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const GITHUB_TOKEN_ENV = "BNX_DEPLOY_GITHUB_TOKEN";

type GithubActor =
  | { __typename: "App"; slug: string }
  | { __typename: "Team"; slug: string }
  | { __typename: "User"; login: string };

type GithubRuleNode = {
  pattern: string;
  allowsForcePushes: boolean;
  requiresLinearHistory: boolean;
  requiredStatusCheckContexts: string[];
  matchingRefs: { nodes: Array<{ name: string }> };
  pushAllowances: { nodes: Array<{ actor: GithubActor | null }> };
  bypassPullRequestAllowances: { nodes: Array<{ actor: GithubActor | null }> };
  bypassForcePushAllowances: { nodes: Array<{ actor: GithubActor | null }> };
};

type GithubResponse = {
  data?: {
    repository?: {
      branchProtectionRules?: {
        nodes?: GithubRuleNode[];
      };
    };
  };
  errors?: Array<{ message?: string }>;
};

function parseRepository(repository: string) {
  const [owner, name, ...rest] = repository.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error(`github governance repository must be owner/repo: ${repository}`);
  }
  return { owner, name };
}

function actorId(actor: GithubActor | null): string | undefined {
  if (!actor) return undefined;
  if (actor.__typename === "App") return `app:${actor.slug}`;
  if (actor.__typename === "Team") return `team:${actor.slug}`;
  return `user:${actor.login}`;
}

function sortedUnique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value))).sort();
}

function matchingRule(rules: GithubRuleNode[], branch: string): GithubRuleNode | undefined {
  return rules.find(
    (rule) => rule.pattern === branch || rule.matchingRefs.nodes.some((ref) => ref.name === branch),
  );
}

async function queryGithubRules(opts: {
  repository: string;
  branch: string;
  env?: NodeJS.ProcessEnv;
}): Promise<GithubRuleNode[]> {
  const env = opts.env || process.env;
  const token = String(env[GITHUB_TOKEN_ENV] || "").trim() || String(env.GITHUB_TOKEN || "").trim();
  if (!token) {
    throw new Error(
      `set ${GITHUB_TOKEN_ENV} (or GITHUB_TOKEN) so the service can verify live GitHub lane governance`,
    );
  }
  const { owner, name } = parseRepository(opts.repository);
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `
        query LaneGovernance($owner: String!, $name: String!, $branch: String!) {
          repository(owner: $owner, name: $name) {
            branchProtectionRules(first: 100) {
              nodes {
                pattern
                allowsForcePushes
                requiresLinearHistory
                requiredStatusCheckContexts
                matchingRefs(query: $branch, first: 1) { nodes { name } }
                pushAllowances(first: 50) { nodes { actor { __typename ... on App { slug } ... on Team { slug } ... on User { login } } } }
                bypassPullRequestAllowances(first: 50) { nodes { actor { __typename ... on App { slug } ... on Team { slug } ... on User { login } } } }
                bypassForcePushAllowances(first: 50) { nodes { actor { __typename ... on App { slug } ... on Team { slug } ... on User { login } } } }
              }
            }
          }
        }
      `,
      variables: { owner, name, branch: opts.branch },
    }),
  });
  const payload = (await response.json()) as GithubResponse;
  if (!response.ok) {
    throw new Error(
      `GitHub governance lookup failed for ${opts.repository}: ${payload.errors?.[0]?.message || response.statusText}`,
    );
  }
  return payload.data?.repository?.branchProtectionRules?.nodes || [];
}

export async function fetchGithubLaneGovernanceSnapshot(opts: {
  lanePolicy: DeploymentLanePolicy;
  env?: NodeJS.ProcessEnv;
}): Promise<DeploymentLaneGovernanceSnapshot> {
  const governance = opts.lanePolicy.governance;
  const rulesByBranch = new Map(
    await Promise.all(
      governance.branchProtections.map(async (declared) => [
        declared.branch,
        await queryGithubRules({
          repository: governance.repository,
          branch: declared.branch,
          env: opts.env,
        }),
      ]),
    ),
  );
  return {
    scmBackend: "github",
    repository: governance.repository,
    branchProtections: governance.branchProtections.map((declared) => {
      const rule = matchingRule(rulesByBranch.get(declared.branch) || [], declared.branch);
      if (!rule) throw new Error(`missing required protected branch for ${declared.stage}`);
      if (!rule.requiresLinearHistory || rule.allowsForcePushes) {
        throw new Error(`missing fast-forward-only enforcement for ${declared.stage}`);
      }
      return {
        stage: declared.stage,
        branch: declared.branch,
        requiredChecks: sortedUnique(rule.requiredStatusCheckContexts),
        fastForwardOnly: true,
        normalAdvancePrincipals: sortedUnique([
          ...rule.pushAllowances.nodes.map((entry) => actorId(entry.actor)),
          ...rule.bypassPullRequestAllowances.nodes.map((entry) => actorId(entry.actor)),
        ]),
        emergencyDirectPushPrincipals: sortedUnique(
          rule.bypassForcePushAllowances.nodes.map((entry) => actorId(entry.actor)),
        ),
      };
    }),
  };
}
