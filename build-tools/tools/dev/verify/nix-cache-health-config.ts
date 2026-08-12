import { execFile } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { promisify } from "node:util";
import {
  currentNixCachePolicyCapability,
  nixCachePolicyBindingDigest,
  outcomeFromNixCachePolicyCapability,
  type NixCachePolicyCapabilityOutcome,
} from "../../lib/nix-cache-policy-capability";
import { parseNixCacheConfigValues } from "../../lib/nix-cache-readiness";
import {
  NESTED_CACHE_ROLE_AUTHORITY,
  NESTED_CACHE_ROLE_CONFIG,
} from "./nested-cache-role-transport";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import {
  readEffectiveNixCacheRoleProvenance,
  type CacheRoles,
} from "../../lib/nix-cache-role-provenance";

const execFileAsync = promisify(execFile);
const OVERRIDE_KEYS = new Set([
  "substituters",
  "extra-substituters",
  "connect-timeout",
  "stalled-download-timeout",
  "fallback",
]);

export type NixCachePolicy = "auto" | "strict" | "off";

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function isProbeableUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

export function stripOverrideKeys(config: string): string {
  return config
    .split("\n")
    .filter((line) => {
      const eq = line.indexOf("=");
      if (eq <= 0) return true;
      return !OVERRIDE_KEYS.has(line.slice(0, eq).trim());
    })
    .join("\n")
    .trim();
}

export function renderReviewedNixCacheConfig(
  config: string,
  requiredSubstituters: string[],
  optionalSubstituters: string[],
): string {
  return [
    stripOverrideKeys(config),
    `substituters = ${requiredSubstituters.join(" ")}`,
    `extra-substituters = ${optionalSubstituters.join(" ")}`,
    "connect-timeout = 3",
    "stalled-download-timeout = 10",
    "fallback = true",
  ]
    .filter(Boolean)
    .join("\n");
}

export function defaultNixCacheReviewEnv(): NodeJS.ProcessEnv {
  return withSanitizedInheritedNixConfig(envWithResolvedNixBin({ ...process.env }));
}

export async function defaultReadEffectiveConfig(): Promise<string> {
  const nixEnv = defaultNixCacheReviewEnv();
  const nixBin = resolveToolPathSync("nix", nixEnv);
  try {
    const res = await execFileAsync(nixBin, ["config", "show"], { env: nixEnv });
    return String(res.stdout || "").trim();
  } catch (error) {
    throw new Error("nix config show failed during cache health evaluation", { cause: error });
  }
}

export function defaultReadCacheRoleProvenance(): CacheRoles | undefined {
  const nixEnv = defaultNixCacheReviewEnv();
  return readEffectiveNixCacheRoleProvenance(resolveToolPathSync("nix", nixEnv), nixEnv);
}

export function configScalar(config: string, key: string): string {
  for (const line of config.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.slice(0, eq).trim() !== key) continue;
    return line.slice(eq + 1).trim();
  }
  return "";
}

export function reviewedConfigWithNetrc(config: string, netrcFile: string): string {
  const retained = config
    .split("\n")
    .filter((line) => {
      const eq = line.indexOf("=");
      return eq <= 0 || line.slice(0, eq).trim() !== "netrc-file";
    })
    .join("\n")
    .trim();
  if (!netrcFile) return retained;
  try {
    if (!fs.statSync(netrcFile).isFile()) return retained;
    fs.accessSync(netrcFile, fs.constants.R_OK);
  } catch {
    return retained;
  }
  return [retained, `netrc-file = ${netrcFile}`].filter(Boolean).join("\n");
}

export function policyFromEnv(): NixCachePolicy {
  const raw = String(process.env.VBR_NIX_CACHE_POLICY || "auto").trim();
  if (raw === "strict" || raw === "off" || raw === "auto") return raw;
  throw new Error(`unsupported VBR_NIX_CACHE_POLICY "${raw}"`);
}

export function trustedCachePolicyOutcome(): NixCachePolicyCapabilityOutcome | undefined {
  try {
    return outcomeFromNixCachePolicyCapability(currentNixCachePolicyCapability());
  } catch {
    return undefined;
  }
}

export function proofBoundCachePolicyOutcome(
  env: NodeJS.ProcessEnv,
): Extract<NixCachePolicyCapabilityOutcome, { kind: "reviewed" }> | undefined {
  if (env.VBR_NIX_CACHE_ROLE_AUTHORITY !== NESTED_CACHE_ROLE_AUTHORITY) return undefined;
  const names = [
    "VBR_NIX_CACHE_ROLE_REQUIRED",
    "VBR_NIX_CACHE_ROLE_OPTIONAL",
    "VBR_NIX_CACHE_ROLE_POLICY",
    "VBR_NIX_CACHE_ROLE_BINDING",
    NESTED_CACHE_ROLE_CONFIG,
  ] as const;
  const present = names.map((name) => Object.prototype.hasOwnProperty.call(env, name));
  if (present.every((value) => !value)) return undefined;
  if (present.some((value) => !value)) {
    throw new Error("proof-bound Nix cache role environment is incomplete");
  }
  const policy = env.VBR_NIX_CACHE_ROLE_POLICY;
  if (policy !== "auto" && policy !== "strict") {
    throw new Error("proof-bound Nix cache role policy is invalid");
  }
  const encodedConfig = String(env[NESTED_CACHE_ROLE_CONFIG] || "");
  const decodedConfig = Buffer.from(encodedConfig, "base64");
  if (decodedConfig.toString("base64") !== encodedConfig) {
    throw new Error("proof-bound Nix cache role config is invalid");
  }
  const config = decodedConfig.toString("utf8");
  const requiredSubstituters = unique(
    String(env.VBR_NIX_CACHE_ROLE_REQUIRED || "")
      .split(/\s+/u)
      .filter(Boolean),
  );
  const optionalSubstituters = unique(
    String(env.VBR_NIX_CACHE_ROLE_OPTIONAL || "")
      .split(/\s+/u)
      .filter(Boolean),
  );
  const parsed = parseNixCacheConfigValues(config);
  const effective = unique([
    ...(parsed.get("substituters") || []),
    ...(parsed.get("extra-substituters") || []),
  ]).sort();
  const bound = unique([...requiredSubstituters, ...optionalSubstituters]).sort();
  if (
    effective.length !== bound.length ||
    !effective.every((value, index) => value === bound[index])
  ) {
    throw new Error(
      `proof-bound Nix cache roles do not match active config (effective_count=${effective.length} bound_count=${bound.length})`,
    );
  }
  const outcome = {
    kind: "reviewed" as const,
    config,
    policy,
    requiredSubstituters,
    optionalSubstituters,
  };
  if (nixCachePolicyBindingDigest(outcome) !== env.VBR_NIX_CACHE_ROLE_BINDING) {
    throw new Error("proof-bound Nix cache role binding is invalid");
  }
  return outcome;
}
