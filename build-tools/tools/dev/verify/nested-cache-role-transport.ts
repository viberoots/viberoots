import {
  nixCachePolicyBindingDigest,
  type NixCachePolicyCapabilityOutcome,
} from "../../lib/nix-cache-policy-capability";
import { parseNixCacheConfigValues } from "../../lib/nix-cache-readiness";

const ALIASES = {
  required: "VBR_VERIFY_NESTED_CACHE_REQUIRED",
  optional: "VBR_VERIFY_NESTED_CACHE_OPTIONAL",
  policy: "VBR_VERIFY_NESTED_CACHE_POLICY",
  binding: "VBR_VERIFY_NESTED_CACHE_BINDING",
  config: "VBR_VERIFY_NESTED_CACHE_CONFIG",
} as const;
export const NESTED_CACHE_ROLE_AUTHORITY = "verify-nested-v1";
export const NESTED_CACHE_ROLE_CONFIG = "VBR_NIX_CACHE_ROLE_CONFIG_B64";

type Reviewed = Extract<NixCachePolicyCapabilityOutcome, { kind: "reviewed" }>;

export function nestedCacheRoleTransportEnv(reviewed: Reviewed): Record<string, string> {
  return {
    [ALIASES.required]: reviewed.requiredSubstituters.join(" "),
    [ALIASES.optional]: reviewed.optionalSubstituters.join(" "),
    [ALIASES.policy]: reviewed.policy,
    [ALIASES.binding]: nixCachePolicyBindingDigest(reviewed),
    [ALIASES.config]: Buffer.from(reviewed.config, "utf8").toString("base64"),
  };
}

export function consumeNestedCacheRoleTransport(env: NodeJS.ProcessEnv): string[] {
  const values = Object.values(ALIASES).map((name) => env[name]);
  for (const name of Object.values(ALIASES)) delete env[name];
  if (values.every((value) => value === undefined)) return [];
  if (values.some((value) => value === undefined)) {
    throw new Error("nested cache role transport is incomplete");
  }
  const required = String(values[0] || "")
    .split(/\s+/u)
    .filter(Boolean);
  const optional = String(values[1] || "")
    .split(/\s+/u)
    .filter(Boolean);
  const policy = values[2];
  const binding = values[3];
  const encodedConfig = String(values[4] || "");
  const decodedConfig = Buffer.from(encodedConfig, "base64");
  if (decodedConfig.toString("base64") !== encodedConfig) {
    throw new Error("nested cache role transport config is invalid");
  }
  const config = decodedConfig.toString("utf8");
  if (policy !== "auto" && policy !== "strict") {
    throw new Error("nested cache role transport policy is invalid");
  }
  const parsed = parseNixCacheConfigValues(config);
  const effective = [
    ...new Set([
      ...(parsed.get("substituters") || []),
      ...(parsed.get("extra-substituters") || []),
    ]),
  ].sort();
  const bound = [...new Set([...required, ...optional])].sort();
  if (effective.length !== bound.length || !effective.every((value, i) => value === bound[i])) {
    throw new Error(
      `nested cache role transport does not match effective substituters (effective_count=${effective.length} bound_count=${bound.length})`,
    );
  }
  const reviewed: Reviewed = {
    kind: "reviewed",
    config,
    policy,
    requiredSubstituters: required,
    optionalSubstituters: optional,
  };
  if (nixCachePolicyBindingDigest(reviewed) !== binding) {
    throw new Error("nested cache role transport binding is invalid");
  }
  env.NIX_CONFIG = config;
  env.VBR_NIX_CACHE_ROLE_REQUIRED = required.join(" ");
  env.VBR_NIX_CACHE_ROLE_OPTIONAL = optional.join(" ");
  env.VBR_NIX_CACHE_ROLE_POLICY = policy;
  env.VBR_NIX_CACHE_ROLE_BINDING = binding;
  env[NESTED_CACHE_ROLE_CONFIG] = encodedConfig;
  env.VBR_NIX_CACHE_ROLE_AUTHORITY = NESTED_CACHE_ROLE_AUTHORITY;
  return [
    "--env",
    `NIX_CONFIG=${config}`,
    "--env",
    `VBR_NIX_CACHE_ROLE_REQUIRED=${required.join(" ")}`,
    "--env",
    `VBR_NIX_CACHE_ROLE_OPTIONAL=${optional.join(" ")}`,
    "--env",
    `VBR_NIX_CACHE_ROLE_POLICY=${policy}`,
    "--env",
    `VBR_NIX_CACHE_ROLE_BINDING=${binding}`,
    "--env",
    `${NESTED_CACHE_ROLE_CONFIG}=${encodedConfig}`,
    "--env",
    `VBR_NIX_CACHE_ROLE_AUTHORITY=${NESTED_CACHE_ROLE_AUTHORITY}`,
  ];
}
