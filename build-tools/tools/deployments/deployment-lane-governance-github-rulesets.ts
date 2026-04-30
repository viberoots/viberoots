#!/usr/bin/env zx-wrapper

type GithubActor =
  | { __typename: "App"; slug: string }
  | { __typename: "Team"; slug: string }
  | { __typename: "User"; login: string };

type GithubRulesetBypassActor = {
  bypassMode: "ALWAYS" | "PULL_REQUEST" | "EXEMPT" | string;
  deployKey: boolean;
  enterpriseOwner: boolean;
  enterpriseRole: boolean;
  organizationAdmin: boolean;
  repositoryRoleName: string | null;
  actor: GithubActor | null;
};

type GithubRulesetRule = {
  type: string;
  parameters:
    | {
        __typename: "RequiredStatusChecksParameters";
        requiredStatusChecks: Array<{ context: string }>;
      }
    | { __typename: string }
    | null;
};

export type GithubRulesetNode = {
  name: string;
  target: string;
  enforcement: string;
  conditions: {
    refName?: {
      include: string[];
      exclude: string[];
    } | null;
  };
  bypassActors: { nodes: GithubRulesetBypassActor[] };
  rules: { nodes: GithubRulesetRule[] };
};

export type GithubRulesetGovernance = {
  requiredChecks: string[];
  fastForwardOnly: boolean;
  normalAdvancePrincipals: string[];
  emergencyDirectPushPrincipals: string[];
};

function actorId(actor: GithubActor | null): string | undefined {
  if (!actor) return undefined;
  if (actor.__typename === "App") return `app:${actor.slug}`;
  if (actor.__typename === "Team") return `team:${actor.slug}`;
  return `user:${actor.login}`;
}

function bypassActorId(entry: GithubRulesetBypassActor): string | undefined {
  const explicitActor = actorId(entry.actor);
  if (explicitActor) return explicitActor;
  if (entry.repositoryRoleName) return `repository-role:${entry.repositoryRoleName}`;
  if (entry.organizationAdmin) return "organization-admin";
  if (entry.deployKey) return "deploy-key";
  if (entry.enterpriseOwner) return "enterprise-owner";
  if (entry.enterpriseRole) return "enterprise-role";
  return undefined;
}

function sortedUnique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value))).sort();
}

function regexEscape(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function githubPatternToRegExp(pattern: string): RegExp {
  const parts = pattern.split(/(\*\*)|(\*)/g).filter((part) => part !== undefined && part !== "");
  const source = parts
    .map((part) => {
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return regexEscape(part);
    })
    .join("");
  return new RegExp(`^${source}$`);
}

function rulesetMatchesBranch(ruleset: GithubRulesetNode, branch: string): boolean {
  if (ruleset.target !== "BRANCH" || ruleset.enforcement !== "ACTIVE") return false;
  const refName = ruleset.conditions.refName;
  if (!refName) return false;
  const fullRef = `refs/heads/${branch}`;
  const included = refName.include.some((pattern) => githubPatternToRegExp(pattern).test(fullRef));
  const excluded = refName.exclude.some((pattern) => githubPatternToRegExp(pattern).test(fullRef));
  return included && !excluded;
}

function rulesetStatusChecks(ruleset: GithubRulesetNode): string[] {
  return sortedUnique(
    ruleset.rules.nodes.flatMap((rule) =>
      rule.parameters?.__typename === "RequiredStatusChecksParameters"
        ? rule.parameters.requiredStatusChecks.map((check) => check.context)
        : [],
    ),
  );
}

function rulesetBypassPrincipals(ruleset: GithubRulesetNode): string[] {
  return sortedUnique(
    ruleset.bypassActors.nodes
      .filter((entry) => entry.bypassMode === "ALWAYS" || entry.bypassMode === "PULL_REQUEST")
      .map((entry) => bypassActorId(entry)),
  );
}

export function githubRulesetGovernanceFor(
  rulesets: GithubRulesetNode[],
  branch: string,
): GithubRulesetGovernance | undefined {
  const matching = rulesets.filter((ruleset) => rulesetMatchesBranch(ruleset, branch));
  if (matching.length === 0) return undefined;
  const ruleTypes = new Set(
    matching.flatMap((ruleset) => ruleset.rules.nodes.map((rule) => rule.type)),
  );
  const principals = sortedUnique(matching.flatMap((ruleset) => rulesetBypassPrincipals(ruleset)));
  return {
    requiredChecks: sortedUnique(matching.flatMap((ruleset) => rulesetStatusChecks(ruleset))),
    fastForwardOnly: ruleTypes.has("REQUIRED_LINEAR_HISTORY") && ruleTypes.has("NON_FAST_FORWARD"),
    normalAdvancePrincipals: principals,
    emergencyDirectPushPrincipals: principals,
  };
}
