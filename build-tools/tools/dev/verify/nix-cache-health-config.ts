import { execFile } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { promisify } from "node:util";
import {
  currentNixCachePolicyCapability,
  outcomeFromNixCachePolicyCapability,
  type NixCachePolicyCapabilityOutcome,
} from "../../lib/nix-cache-policy-capability";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";

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

export async function defaultReadEffectiveConfig(): Promise<string> {
  const nixEnv = withSanitizedInheritedNixConfig(envWithResolvedNixBin({ ...process.env }));
  const nixBin = resolveToolPathSync("nix", nixEnv);
  try {
    const res = await execFileAsync(nixBin, ["config", "show"], { env: nixEnv });
    return String(res.stdout || "").trim();
  } catch (error) {
    throw new Error("nix config show failed during cache health evaluation", { cause: error });
  }
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
