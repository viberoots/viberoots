import process from "node:process";
import "zx/globals";

const CACHE_KEYS = new Set(["substituters", "extra-substituters"]);
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

function splitWords(value: string): string[] {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseConfigValues(text: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!CACHE_KEYS.has(key)) continue;
    values.set(key, [...(values.get(key) || []), ...splitWords(value)]);
  }
  return values;
}

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

function cacheInfoUrl(raw: string): string {
  const base = raw.split("?")[0].replace(/\/+$/, "");
  return `${base}/nix-cache-info`;
}

async function defaultProbeUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cacheInfoUrl(url), {
      method: "HEAD",
      signal: controller.signal,
    });
    return res.ok || res.status === 405;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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
  if (policy === "off") return { changed: false, kept: [], removed: [] };

  const log = deps.log || ((line: string) => process.stderr.write(`${line}\n`));
  const effectiveConfig = await (deps.readEffectiveConfig || defaultReadEffectiveConfig)();
  const parsed = parseConfigValues(effectiveConfig);
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
