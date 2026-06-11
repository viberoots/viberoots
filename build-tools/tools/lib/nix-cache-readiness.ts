export type NixCachePolicy = "auto" | "strict" | "off";

export type NixCacheSubstituterStatus = {
  url: string;
  role: "required" | "optional";
  kind: "http" | "local";
  state: "reachable" | "unreachable" | "not_probed";
};

export type NixCacheReadiness = {
  schemaVersion: "nix-cache-readiness@1";
  policy: NixCachePolicy;
  state: "disabled" | "ready" | "degraded" | "failed" | "not_configured";
  message: string;
  requiredSubstituters: string[];
  optionalSubstituters: string[];
  statuses: NixCacheSubstituterStatus[];
};

export function parseNixCacheConfigValues(text: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key !== "substituters" && key !== "extra-substituters") continue;
    values.set(key, [...(values.get(key) || []), ...splitWords(line.slice(eq + 1).trim())]);
  }
  return values;
}

export async function evaluateNixCacheReadinessFromConfig(
  effectiveConfig: string,
  policy: NixCachePolicy,
  probeUrl: (url: string, timeoutMs: number) => Promise<boolean>,
): Promise<NixCacheReadiness> {
  const parsed = parseNixCacheConfigValues(effectiveConfig);
  const required = unique(parsed.get("substituters") || []);
  const optional = unique(parsed.get("extra-substituters") || []);
  const requiredIdentities = required.map(substituterIdentity);
  const optionalIdentities = optional.map(substituterIdentity);
  if (policy === "off")
    return readiness(policy, "disabled", requiredIdentities, optionalIdentities, []);
  if (required.length + optional.length === 0)
    return readiness(policy, "not_configured", [], [], []);
  const statuses: NixCacheSubstituterStatus[] = [];
  for (const entry of [
    ...required.map((url) => ({ role: "required" as const, url })),
    ...optional.map((url) => ({ role: "optional" as const, url })),
  ]) {
    statuses.push(await substituterStatus(entry.url, entry.role, probeUrl));
  }
  const unreachable = statuses.filter((entry) => entry.state === "unreachable");
  const state = unreachable.length === 0 ? "ready" : policy === "strict" ? "failed" : "degraded";
  return readiness(policy, state, requiredIdentities, optionalIdentities, statuses);
}

function splitWords(value: string): string[] {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function substituterStatus(
  url: string,
  role: "required" | "optional",
  probe: (url: string, timeoutMs: number) => Promise<boolean>,
): Promise<NixCacheSubstituterStatus> {
  const identity = substituterIdentity(url);
  if (!/^https?:\/\//.test(url)) return { url: identity, role, kind: "local", state: "not_probed" };
  const ok = await probe(cacheInfoUrl(url), 3000).catch(() => false);
  return { url: identity, role, kind: "http", state: ok ? "reachable" : "unreachable" };
}

function cacheInfoUrl(raw: string): string {
  const base = raw.split("?")[0].replace(/\/+$/, "");
  return `${base}/nix-cache-info`;
}

function substituterIdentity(raw: string): string {
  try {
    const url = new URL(raw);
    const auth = url.username || url.password ? "<redacted>@" : "";
    const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${auth}${url.host}${path}`;
  } catch {
    return raw;
  }
}

function readiness(
  policy: NixCachePolicy,
  state: NixCacheReadiness["state"],
  requiredSubstituters: string[],
  optionalSubstituters: string[],
  statuses: NixCacheSubstituterStatus[],
): NixCacheReadiness {
  return {
    schemaVersion: "nix-cache-readiness@1",
    policy,
    state,
    message: readinessMessage(state, statuses),
    requiredSubstituters,
    optionalSubstituters,
    statuses,
  };
}

function readinessMessage(
  state: NixCacheReadiness["state"],
  statuses: NixCacheSubstituterStatus[],
): string {
  if (state === "disabled") return "cache readiness check disabled by VBR_NIX_CACHE_POLICY=off";
  if (state === "not_configured") return "no Nix substituters are configured";
  const unavailable = statuses
    .filter((entry) => entry.state === "unreachable")
    .map((entry) => entry.url);
  if (state === "ready") return "configured Nix substituters are reachable or local";
  if (state === "failed") {
    return `strict cache policy failed for unavailable substituter(s): ${unavailable.join(", ")}`;
  }
  return `optional local fallback is active; unavailable substituter(s): ${unavailable.join(", ")}`;
}
