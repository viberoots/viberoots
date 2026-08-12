import { nixCacheSubstituterIdentity } from "../../lib/nix-cache-readiness";
import { recordReviewedCacheResult } from "./nix-cache-health-review";
import { stripOverrideKeys, unique, type NixCachePolicy } from "./nix-cache-health-config";
import type { CacheHealthResult } from "./nix-cache-health-types";

export function finalizeReachableNixCacheResult(opts: {
  policy: NixCachePolicy;
  priorConfig: string;
  reviewedConfig: string;
  required: string[];
  optional: string[];
  available: string[];
  removed: string[];
  log: (line: string) => void;
}): CacheHealthResult {
  if (opts.removed.length === 0) {
    if (opts.reviewedConfig) process.env.NIX_CONFIG = opts.reviewedConfig;
    else delete process.env.NIX_CONFIG;
    return recordReviewedCacheResult(
      {
        authority: "reviewed",
        changed: opts.reviewedConfig !== opts.priorConfig,
        kept: unique([...opts.required, ...opts.optional]),
        removed: [],
        nixConfig: opts.reviewedConfig,
        requiredSubstituters: [],
        optionalSubstituters: [],
      },
      opts.required,
      opts.optional,
      opts.policy,
    );
  }
  const removedIdentities = opts.removed.map(nixCacheSubstituterIdentity);
  if (opts.policy === "strict") {
    throw new Error(`configured Nix substituter(s) unavailable: ${removedIdentities.join(" ")}`);
  }
  const requiredKept = opts.required.filter((substituter) => opts.available.includes(substituter));
  const optionalKept = opts.optional.filter((substituter) => opts.available.includes(substituter));
  const retainedEnv = stripOverrideKeys(opts.reviewedConfig);
  process.env.NIX_CONFIG = [
    retainedEnv,
    `substituters = ${requiredKept.join(" ")}`,
    `extra-substituters = ${optionalKept.join(" ")}`,
    "connect-timeout = 3",
    "stalled-download-timeout = 10",
    "fallback = true",
  ]
    .filter(Boolean)
    .join("\n");
  opts.log(
    `[verify] nix cache health: disabled unreachable substituter(s): ${removedIdentities.join(" ")}`,
  );
  opts.log(
    `[verify] nix cache health: using optional substituter(s): ${
      optionalKept.map(nixCacheSubstituterIdentity).join(" ") || "<none>"
    }`,
  );
  return recordReviewedCacheResult(
    {
      authority: "reviewed",
      changed: true,
      kept: unique([...requiredKept, ...optionalKept]),
      removed: opts.removed,
      nixConfig: process.env.NIX_CONFIG,
      requiredSubstituters: [],
      optionalSubstituters: [],
    },
    requiredKept,
    optionalKept,
    opts.policy,
  );
}
