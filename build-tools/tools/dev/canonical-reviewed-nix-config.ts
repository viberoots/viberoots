import { createHash } from "node:crypto";

import {
  artifactSelectorNames,
  assertNoArtifactSelectorInjection,
} from "../lib/artifact-environment-policy";
import { activateNixCachePolicyCapabilityAfterCanonicalEntry } from "../lib/nix-cache-policy-capability";
import { consumeReviewedNixConfigProof } from "./canonical-reviewed-nix-config-proof";

const CANONICAL_ENV_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "NIX_CONFIG",
  "NIX_REMOTE",
  "NIX_SSL_CERT_FILE",
  "PATH",
  "SSL_CERT_FILE",
  "SOURCE_DATE_EPOCH",
  "TMPDIR",
  "TZ",
  "VBR_ARTIFACT_TOOLS_ROOT",
  "VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST",
  "VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS",
  "VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY",
  "VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS",
  "VBR_NIX_BIN",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "ZX_INIT",
] as const;

export type ReviewedNixConfigOutcome = {
  applied: boolean;
  config: string;
  policy?: "auto" | "strict";
  requiredSubstituters?: string[];
  optionalSubstituters?: string[];
};

function reviewedConfigDigest(outcome: ReviewedNixConfigOutcome): string {
  return createHash("sha256")
    .update(
      [
        "applied-v2",
        outcome.policy || "auto",
        (outcome.requiredSubstituters || []).join(" "),
        (outcome.optionalSubstituters || []).join(" "),
        outcome.config,
      ].join("\0"),
    )
    .digest("hex");
}

export function canonicalReviewedConfig(env: NodeJS.ProcessEnv): {
  applied: boolean;
  config: string;
  valid: boolean;
  policy?: "auto" | "strict";
  requiredSubstituters?: string[];
  optionalSubstituters?: string[];
} {
  const config = String(env.NIX_CONFIG || "");
  const digest = String(env.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST || "");
  if (!digest) return { applied: false, config, valid: !config };
  const policy = String(env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY || "");
  if (policy !== "auto" && policy !== "strict") return { applied: true, config, valid: false };
  const requiredSubstituters = String(env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS || "")
    .split(/\s+/u)
    .filter(Boolean);
  const optionalSubstituters = String(env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS || "")
    .split(/\s+/u)
    .filter(Boolean);
  const outcome = {
    applied: true,
    config,
    policy,
    requiredSubstituters,
    optionalSubstituters,
  } as const;
  return {
    ...outcome,
    valid: digest === reviewedConfigDigest(outcome),
  };
}

export function consumeArtifactIngressReviewedNixConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReviewedNixConfigOutcome {
  const token = String(env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN || "");
  const applied = env.VBR_NIX_CACHE_HEALTH_APPLIED === "1";
  const reviewed = String(env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG || "");
  const reviewedRequired = String(env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS || "");
  const reviewedOptional = String(env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS || "");
  const reviewedPolicy = String(env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY || "");
  delete env.VBR_NIX_CACHE_HEALTH_APPLIED;
  delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
  delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS;
  delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS;
  delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY;
  const parsed = consumeReviewedNixConfigProof(env);
  if (
    !parsed ||
    parsed.token !== token ||
    !applied ||
    parsed.config !== reviewed ||
    parsed.requiredSubstituters.join(" ") !== reviewedRequired.trim() ||
    parsed.optionalSubstituters.join(" ") !== reviewedOptional.trim() ||
    parsed.policy !== reviewedPolicy
  ) {
    return { applied: false, config: "" };
  }
  return {
    applied: true,
    config: parsed.config,
    policy: parsed.policy,
    requiredSubstituters: parsed.requiredSubstituters,
    optionalSubstituters: parsed.optionalSubstituters,
  };
}

export function attachCanonicalReviewedNixConfig(
  env: NodeJS.ProcessEnv,
  outcome: ReviewedNixConfigOutcome,
): NodeJS.ProcessEnv {
  if (!outcome.applied) return env;
  if (outcome.config) env.NIX_CONFIG = outcome.config;
  else delete env.NIX_CONFIG;
  env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS = (
    outcome.requiredSubstituters || []
  ).join(" ");
  env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS = (
    outcome.optionalSubstituters || []
  ).join(" ");
  env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY = outcome.policy || "auto";
  env.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST = reviewedConfigDigest(outcome);
  return env;
}

export function activateCanonicalNixCachePolicy(
  env: NodeJS.ProcessEnv,
  outcome: ReviewedNixConfigOutcome,
): void {
  const parsedRoles = (() => {
    const values = new Map<string, string[]>();
    for (const line of outcome.config.split("\n")) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (key !== "substituters" && key !== "extra-substituters") continue;
      values.set(
        key,
        line
          .slice(eq + 1)
          .trim()
          .split(/\s+/u)
          .filter(Boolean),
      );
    }
    return {
      required: outcome.requiredSubstituters || values.get("substituters") || [],
      optional: outcome.optionalSubstituters || values.get("extra-substituters") || [],
    };
  })();
  const policy = outcome.applied
    ? ({
        kind: "reviewed",
        config: outcome.config,
        policy: outcome.policy || "auto",
        requiredSubstituters: parsedRoles.required,
        optionalSubstituters: parsedRoles.optional,
      } as const)
    : env.VBR_NIX_CACHE_POLICY === "off"
      ? ({ kind: "off" } as const)
      : null;
  if (!policy) return;
  if (env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT !== "1") {
    throw new Error("cannot activate Nix cache policy authority before canonical entry");
  }
  delete env.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST;
  if (policy.kind === "reviewed") {
    env.VBR_NIX_CACHE_HEALTH_APPLIED = "1";
    env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG = policy.config;
    env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS = policy.requiredSubstituters.join(" ");
    env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS = policy.optionalSubstituters.join(" ");
    env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY = policy.policy;
  } else {
    delete env.VBR_NIX_CACHE_HEALTH_APPLIED;
    delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
    delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS;
    delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS;
    delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY;
  }
  activateNixCachePolicyCapabilityAfterCanonicalEntry(env, policy);
}

export function canonicalArtifactEnvironmentDifferences(
  actual: NodeJS.ProcessEnv,
  expected: NodeJS.ProcessEnv,
): string[] {
  const differences: string[] = [];
  if (actual.VBR_CANONICAL_ARTIFACT_ENTRYPOINT !== "1") differences.push("canonical-marker");
  for (const name of CANONICAL_ENV_KEYS) {
    if (actual[name] !== expected[name]) differences.push(name);
  }
  const allowed = new Set(["VBR_ARTIFACT_TOOLS_ROOT"]);
  const actualReviewed = canonicalReviewedConfig(actual);
  const expectedReviewed = canonicalReviewedConfig(expected);
  if (!actualReviewed.valid || !expectedReviewed.valid) {
    differences.push("reviewed-nix-config-digest");
  } else if (actualReviewed.config && actualReviewed.config === expectedReviewed.config) {
    allowed.add("NIX_CONFIG");
  }
  for (const name of artifactSelectorNames()) {
    if (!allowed.has(name) && String(actual[name] || "").trim()) differences.push(name);
  }
  try {
    assertNoArtifactSelectorInjection(actual, {
      allow: [...allowed],
      rejectUnknownArtifactAffecting: true,
    });
  } catch (error) {
    differences.push(error instanceof Error ? error.message : "artifact-selector-injection");
  }
  return [...new Set(differences)];
}

export function isCanonicalArtifactEntrypointEnvironment(
  actual: NodeJS.ProcessEnv,
  expected: NodeJS.ProcessEnv,
): boolean {
  return canonicalArtifactEnvironmentDifferences(actual, expected).length === 0;
}
