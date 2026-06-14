import process from "node:process";
import "zx/globals";
import { parseNixCacheConfigValues } from "../../lib/nix-cache-readiness";

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
  log?: (line: string) => void;
};

type CacheHealthResult = {
  changed: boolean;
  kept: string[];
  removed: string[];
  nixConfig?: string;
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
  const res = await $({
    stdio: "pipe",
    reject: false,
  })`nix config show`;
  const stdout = String((res as any).stdout || "").trim();
  if (stdout) return stdout;
  return String(process.env.NIX_CONFIG || "");
}

async function defaultProbeUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(nixCacheInfoUrl(url), { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function nixCacheInfoUrl(raw: string): string {
  const url = new URL(raw);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/nix-cache-info`;
  url.search = "";
  url.hash = "";
  return url.toString();
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
    return { changed: false, kept: [], removed: [] };
  }
  process.env.VBR_NIX_CACHE_HEALTH_APPLIED = "1";
  if (policy === "off") return { changed: false, kept: [], removed: [] };

  const log = deps.log || ((line: string) => process.stderr.write(`${line}\n`));
  const effectiveConfig = await (deps.readEffectiveConfig || defaultReadEffectiveConfig)();
  const parsed = parseNixCacheConfigValues(effectiveConfig);
  const required = unique(parsed.get("substituters") || []);
  const optional = unique(parsed.get("extra-substituters") || []);
  const configured = unique([...required, ...optional]);
  if (configured.length === 0) return { changed: false, kept: [], removed: [] };

  const probe = deps.probeUrl || defaultProbeUrl;
  const available: string[] = [];
  const removed: string[] = [];
  for (const substituter of configured) {
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

  if (removed.length === 0) return { changed: false, kept: configured, removed };
  if (policy === "strict") {
    throw new Error(`configured Nix substituter(s) unavailable: ${removed.join(" ")}`);
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
  log(`[verify] nix cache health: disabled unreachable substituter(s): ${removed.join(" ")}`);
  log(
    `[verify] nix cache health: using optional substituter(s): ${optionalKept.join(" ") || "<none>"}`,
  );
  return {
    changed: true,
    kept: unique([...requiredKept, ...optionalKept]),
    removed,
    nixConfig: process.env.NIX_CONFIG,
  };
}
