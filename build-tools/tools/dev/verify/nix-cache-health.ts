import process from "node:process";
import {
  assertSafeNixCacheConfig,
  assertSafeProbeableNixCacheUrl,
  nixCacheSubstituterIdentity,
  parseNixCacheConfigValues,
} from "../../lib/nix-cache-readiness";
import {
  configScalar,
  defaultReadCacheRoleProvenance,
  defaultReadEffectiveConfig,
  isProbeableUrl,
  policyFromEnv,
  proofBoundCachePolicyOutcome,
  reviewedConfigWithNetrc,
  trustedCachePolicyOutcome,
  unique,
} from "./nix-cache-health-config";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { probeNixCacheUrl } from "./nix-cache-probe";
import { activateNixCachePolicyCapabilityAfterCanonicalEntry } from "../../lib/nix-cache-policy-capability";
import {
  activateReviewedCacheCapability,
  clearReviewedCacheEnvironment,
  recordReviewedCacheResult,
} from "./nix-cache-health-review";
import { offCacheHealthResult } from "./nix-cache-health-types";
import type { CacheHealthResult, NixCacheHealthDeps } from "./nix-cache-health-types";
import { finalizeReachableNixCacheResult } from "./nix-cache-health-result";
export type { NixCachePolicy } from "./nix-cache-health-config";
export type { CacheHealthResult, NixCacheHealthDeps } from "./nix-cache-health-types";

export async function applyNixCacheHealthPolicy(
  _root: string,
  deps: NixCacheHealthDeps = {},
): Promise<CacheHealthResult> {
  const policy = policyFromEnv();
  if (
    process.env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT === "1" &&
    process.env.VBR_NIX_CACHE_HEALTH_APPLIED === "1"
  ) {
    const reviewedPolicy = String(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY || "");
    if (reviewedPolicy !== "auto" && reviewedPolicy !== "strict") {
      throw new Error("canonical Nix cache health authority has an invalid reviewed policy");
    }
    activateNixCachePolicyCapabilityAfterCanonicalEntry(process.env, {
      kind: "reviewed",
      config: String(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG || ""),
      policy: reviewedPolicy,
      requiredSubstituters: String(
        process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS || "",
      )
        .split(/\s+/u)
        .filter(Boolean),
      optionalSubstituters: String(
        process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS || "",
      )
        .split(/\s+/u)
        .filter(Boolean),
    });
  }
  const trusted =
    process.env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT === "1" ? trustedCachePolicyOutcome() : undefined;
  if (trusted?.kind === "reviewed") {
    const activeConfig = String(process.env.NIX_CONFIG || "");
    const reviewedConfig = String(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG || "");
    if (
      process.env.VBR_NIX_CACHE_HEALTH_APPLIED !== "1" ||
      activeConfig !== trusted.config ||
      reviewedConfig !== trusted.config ||
      process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY !== trusted.policy ||
      String(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS || "") !==
        trusted.requiredSubstituters.join(" ") ||
      String(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS || "") !==
        trusted.optionalSubstituters.join(" ")
    ) {
      throw new Error("canonical Nix cache health authority does not match the active config");
    }
    assertSafeNixCacheConfig(trusted.config);
    activateReviewedCacheCapability({
      ...trusted,
      requiredSubstituters: [...trusted.requiredSubstituters],
      optionalSubstituters: [...trusted.optionalSubstituters],
    });
    return {
      authority: "reviewed",
      changed: false,
      kept: [],
      removed: [],
      nixConfig: trusted.config,
      requiredSubstituters: [...trusted.requiredSubstituters],
      optionalSubstituters: [...trusted.optionalSubstituters],
    };
  }
  const proofBound = proofBoundCachePolicyOutcome(process.env);
  if (proofBound) {
    if (policy !== proofBound.policy) {
      throw new Error("proof-bound Nix cache role policy does not match the active policy");
    }
    assertSafeNixCacheConfig(proofBound.config);
    return recordReviewedCacheResult(
      {
        authority: "reviewed",
        changed: false,
        kept: unique([...proofBound.requiredSubstituters, ...proofBound.optionalSubstituters]),
        removed: [],
        nixConfig: proofBound.config,
        requiredSubstituters: [...proofBound.requiredSubstituters],
        optionalSubstituters: [...proofBound.optionalSubstituters],
      },
      [...proofBound.requiredSubstituters],
      [...proofBound.optionalSubstituters],
      proofBound.policy,
    );
  }
  clearReviewedCacheEnvironment();
  const reviewed = (result: CacheHealthResult, required: string[], optional: string[]) =>
    recordReviewedCacheResult(result, required, optional, policy);
  if (policy === "off") {
    if (process.env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT === "1") {
      activateNixCachePolicyCapabilityAfterCanonicalEntry(process.env, { kind: "off" });
    }
    return offCacheHealthResult(String(process.env.NIX_CONFIG || ""));
  }

  const log = deps.log || ((line: string) => process.stderr.write(`${line}\n`));
  const effectiveConfig = await (deps.readEffectiveConfig || defaultReadEffectiveConfig)();
  const priorConfig = String(process.env.NIX_CONFIG || "");
  assertSafeNixCacheConfig(priorConfig);
  const parsed = parseNixCacheConfigValues(effectiveConfig);
  let effectiveRequired = unique(parsed.get("substituters") || []);
  let effectiveOptional = unique(parsed.get("extra-substituters") || []);
  if (effectiveRequired.length > 0 && effectiveOptional.length === 0) {
    const provenance =
      deps.readCacheRoleProvenance === undefined
        ? defaultReadCacheRoleProvenance()
        : deps.readCacheRoleProvenance();
    const provenRequired = unique(provenance?.required || []);
    const provenOptional = unique(provenance?.optional || []).filter(
      (substituter) => !provenRequired.includes(substituter),
    );
    const effectiveFlattened = unique([...effectiveRequired, ...effectiveOptional]).sort();
    const provenFlattened = unique([...provenRequired, ...provenOptional]).sort();
    if (
      effectiveFlattened.length === provenFlattened.length &&
      effectiveFlattened.every((value, index) => value === provenFlattened[index])
    ) {
      effectiveRequired = provenRequired;
      effectiveOptional = provenOptional;
    }
  }
  const priorParsed = parseNixCacheConfigValues(priorConfig);
  const priorRequired = unique(priorParsed.get("substituters") || []);
  const priorOptional = unique(priorParsed.get("extra-substituters") || []);
  const effectiveSet = unique([...effectiveRequired, ...effectiveOptional]).sort();
  const priorSet = unique([...priorRequired, ...priorOptional]).sort();
  const priorRolesMatchEffective =
    priorSet.length === effectiveSet.length &&
    priorSet.every((substituter, index) => substituter === effectiveSet[index]);
  if (priorSet.length > 0 && !priorRolesMatchEffective) {
    throw new Error("reviewed Nix cache source roles do not match effective substituters");
  }
  const required = priorRolesMatchEffective ? priorRequired : effectiveRequired;
  const optional = priorRolesMatchEffective ? priorOptional : effectiveOptional;
  const configured = unique([...required, ...optional]);
  if (configured.length === 0) {
    return reviewed(
      {
        authority: "reviewed",
        changed: false,
        kept: [],
        removed: [],
        nixConfig: String(process.env.NIX_CONFIG || ""),
        requiredSubstituters: [],
        optionalSubstituters: [],
      },
      [],
      [],
    );
  }

  const netrcFile = configScalar(effectiveConfig, "netrc-file");
  const reviewedConfig = reviewedConfigWithNetrc(priorConfig, netrcFile);
  const resolveCurlBin =
    deps.resolveCurlBin || ((env: NodeJS.ProcessEnv) => resolveToolPathSync("curl", env));
  const probe =
    deps.probeUrl ||
    (async (url: string, timeoutMs: number) =>
      await probeNixCacheUrl(url, timeoutMs, netrcFile, resolveCurlBin));
  const available: string[] = [];
  const removed: string[] = [];
  for (const substituter of configured) {
    assertSafeProbeableNixCacheUrl(substituter);
    if (!isProbeableUrl(substituter)) {
      available.push(substituter);
      continue;
    }
    const optionalOnly = optional.includes(substituter) && !required.includes(substituter);
    let reachable = false;
    try {
      reachable = await probe(substituter, 3000);
    } catch (error) {
      if (policy !== "auto" || !optionalOnly) throw error;
    }
    if (reachable) {
      available.push(substituter);
    } else {
      removed.push(substituter);
    }
  }

  return finalizeReachableNixCacheResult({
    policy,
    priorConfig,
    reviewedConfig,
    required,
    optional,
    available,
    removed,
    log,
  });
}
