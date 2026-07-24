import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  nixCacheSubstituterIdentity,
  parseNixCacheConfigValues,
} from "../../lib/nix-cache-readiness";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import { probeNixCacheUrl } from "./nix-cache-probe";

const execFileAsync = promisify(execFile);

const OVERRIDE_KEYS = new Set([
  "substituters",
  "extra-substituters",
  "connect-timeout",
  "stalled-download-timeout",
  "fallback",
]);

export type NixCachePolicy = "auto" | "strict" | "off";

export type NixCacheHealthDeps = {
  readEffectiveConfig?: () => Promise<string>;
  probeUrl?: (url: string, timeoutMs: number) => Promise<boolean>;
  resolveCurlBin?: (env: NodeJS.ProcessEnv) => string;
  log?: (line: string) => void;
};

type CacheHealthResult = {
  authority: "reviewed" | "off";
  changed: boolean;
  kept: string[];
  removed: string[];
  nixConfig: string;
};

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function isProbeableUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function assertValidProbeableUrl(value: string): void {
  if (!/^https?:/u.test(value)) return;
  if (!/^https?:\/\/[^/]/u.test(value)) {
    throw new Error(
      `configured Nix substituter is malformed: ${nixCacheSubstituterIdentity(value)}`,
    );
  }
  try {
    const parsed = new URL(value);
    if (!/^https?:$/u.test(parsed.protocol) || !parsed.hostname) throw new Error("invalid");
  } catch {
    throw new Error(
      `configured Nix substituter is malformed: ${nixCacheSubstituterIdentity(value)}`,
    );
  }
}

function stripOverrideKeys(config: string): string {
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

async function defaultReadEffectiveConfig(): Promise<string> {
  const nixEnv = withSanitizedInheritedNixConfig(envWithResolvedNixBin({ ...process.env }));
  const nixBin = resolveToolPathSync("nix", nixEnv);
  try {
    const res = await execFileAsync(nixBin, ["config", "show"], { env: nixEnv });
    return String(res.stdout || "").trim();
  } catch (error) {
    throw new Error("nix config show failed during cache health evaluation", { cause: error });
  }
}

function configScalar(config: string, key: string): string {
  for (const line of config.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0 || line.slice(0, eq).trim() !== key) continue;
    return line.slice(eq + 1).trim();
  }
  return "";
}

function policyFromEnv(): NixCachePolicy {
  const raw = String(process.env.VBR_NIX_CACHE_POLICY || "auto").trim();
  if (raw === "strict" || raw === "off" || raw === "auto") return raw;
  throw new Error(`unsupported VBR_NIX_CACHE_POLICY "${raw}"`);
}

export async function applyNixCacheHealthPolicy(
  _root: string,
  deps: NixCacheHealthDeps = {},
): Promise<CacheHealthResult> {
  const policy = policyFromEnv();
  if (process.env.VBR_NIX_CACHE_HEALTH_APPLIED === "1") {
    const reviewedConfig = String(process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG || "");
    const activeConfig = String(process.env.NIX_CONFIG || "");
    if (activeConfig && activeConfig !== reviewedConfig) {
      throw new Error("pre-applied Nix cache health config does not match its reviewed authority");
    }
    if (reviewedConfig) process.env.NIX_CONFIG = reviewedConfig;
    else delete process.env.NIX_CONFIG;
    return {
      authority: "reviewed",
      changed: activeConfig !== reviewedConfig,
      kept: [],
      removed: [],
      nixConfig: reviewedConfig,
    };
  }
  delete process.env.VBR_NIX_CACHE_HEALTH_APPLIED;
  delete process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
  const reviewed = (result: CacheHealthResult): CacheHealthResult => {
    process.env.VBR_NIX_CACHE_HEALTH_APPLIED = "1";
    process.env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG = result.nixConfig;
    return result;
  };
  if (policy === "off") {
    return {
      authority: "off",
      changed: false,
      kept: [],
      removed: [],
      nixConfig: String(process.env.NIX_CONFIG || ""),
    };
  }

  const log = deps.log || ((line: string) => process.stderr.write(`${line}\n`));
  const effectiveConfig = await (deps.readEffectiveConfig || defaultReadEffectiveConfig)();
  const parsed = parseNixCacheConfigValues(effectiveConfig);
  const required = unique(parsed.get("substituters") || []);
  const optional = unique(parsed.get("extra-substituters") || []);
  const configured = unique([...required, ...optional]);
  if (configured.length === 0) {
    return reviewed({
      authority: "reviewed",
      changed: false,
      kept: [],
      removed: [],
      nixConfig: String(process.env.NIX_CONFIG || ""),
    });
  }

  const netrcFile = configScalar(effectiveConfig, "netrc-file");
  const resolveCurlBin =
    deps.resolveCurlBin || ((env: NodeJS.ProcessEnv) => resolveToolPathSync("curl", env));
  const probe =
    deps.probeUrl ||
    (async (url: string, timeoutMs: number) =>
      await probeNixCacheUrl(url, timeoutMs, netrcFile, resolveCurlBin));
  const available: string[] = [];
  const removed: string[] = [];
  for (const substituter of configured) {
    assertValidProbeableUrl(substituter);
    if (!isProbeableUrl(substituter)) {
      available.push(substituter);
      continue;
    }
    if (await probe(substituter, 3000)) {
      available.push(substituter);
    } else {
      removed.push(substituter);
    }
  }

  if (removed.length === 0) {
    return reviewed({
      authority: "reviewed",
      changed: false,
      kept: configured,
      removed,
      nixConfig: String(process.env.NIX_CONFIG || ""),
    });
  }
  const removedIdentities = removed.map(nixCacheSubstituterIdentity);
  if (policy === "strict") {
    throw new Error(`configured Nix substituter(s) unavailable: ${removedIdentities.join(" ")}`);
  }
  const requiredKept = required.filter((substituter) => available.includes(substituter));
  const optionalKept = optional.filter((substituter) => available.includes(substituter));
  const retainedEnv = stripOverrideKeys(String(process.env.NIX_CONFIG || ""));
  const overrideLines = [
    `substituters = ${requiredKept.join(" ")}`,
    `extra-substituters = ${optionalKept.join(" ")}`,
    "connect-timeout = 3",
    "stalled-download-timeout = 10",
    "fallback = true",
  ];
  process.env.NIX_CONFIG = [retainedEnv, ...overrideLines].filter(Boolean).join("\n");
  log(
    `[verify] nix cache health: disabled unreachable substituter(s): ${removedIdentities.join(" ")}`,
  );
  log(
    `[verify] nix cache health: using optional substituter(s): ${
      optionalKept.map(nixCacheSubstituterIdentity).join(" ") || "<none>"
    }`,
  );
  return reviewed({
    authority: "reviewed",
    changed: true,
    kept: unique([...requiredKept, ...optionalKept]),
    removed,
    nixConfig: process.env.NIX_CONFIG,
  });
}
