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
  roleProvenance?: {
    requiredSubstituters: readonly string[];
    optionalSubstituters: readonly string[];
  },
): Promise<NixCacheReadiness> {
  const parsed = parseNixCacheConfigValues(effectiveConfig);
  const flattened = unique([
    ...(parsed.get("substituters") || []),
    ...(parsed.get("extra-substituters") || []),
  ]);
  const provenRequired = unique([...(roleProvenance?.requiredSubstituters || [])]);
  const provenOptional = unique([...(roleProvenance?.optionalSubstituters || [])]).filter(
    (entry) => !provenRequired.includes(entry),
  );
  if (
    roleProvenance &&
    (flattened.length !== unique([...provenRequired, ...provenOptional]).length ||
      !flattened.every((entry) => provenRequired.includes(entry) || provenOptional.includes(entry)))
  ) {
    throw new Error("proven Nix cache roles do not match effective config");
  }
  const required = roleProvenance ? provenRequired : unique(parsed.get("substituters") || []);
  const optional = roleProvenance ? provenOptional : unique(parsed.get("extra-substituters") || []);
  for (const substituter of [...required, ...optional]) {
    assertSafeProbeableNixCacheUrl(substituter);
  }
  const requiredIdentities = required.map(nixCacheSubstituterIdentity);
  const optionalIdentities = optional.map(nixCacheSubstituterIdentity);
  if (policy === "off")
    return readiness(policy, "disabled", requiredIdentities, optionalIdentities, []);
  if (required.length + optional.length === 0)
    return readiness(policy, "not_configured", [], [], []);
  const statuses: NixCacheSubstituterStatus[] = [];
  for (const entry of [
    ...required.map((url) => ({ role: "required" as const, url })),
    ...optional.map((url) => ({ role: "optional" as const, url })),
  ]) {
    try {
      statuses.push(await substituterStatus(entry.url, entry.role, probeUrl));
    } catch (error) {
      if (policy !== "auto" || entry.role !== "optional") throw error;
      statuses.push({
        url: nixCacheSubstituterIdentity(entry.url),
        role: entry.role,
        kind: "http",
        state: "unreachable",
      });
    }
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
  const identity = nixCacheSubstituterIdentity(url);
  if (!/^https?:\/\//.test(url)) return { url: identity, role, kind: "local", state: "not_probed" };
  const ok = await probe(url, 3000);
  return { url: identity, role, kind: "http", state: ok ? "reachable" : "unreachable" };
}

export function nixCacheSubstituterIdentity(raw: string): string {
  try {
    const url = new URL(raw);
    const auth = url.username || url.password ? "<redacted>@" : "";
    const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${auth}${url.host}${path}`;
  } catch {
    return "<invalid-substituter>";
  }
}

const CREDENTIAL_KEY =
  /^(?:access[_-]?token|api[_-]?key|apikey|auth|authorization|credential|credentials|password|passwd|secret|sig|signature|token)$/iu;

export function assertSafeProbeableNixCacheUrl(raw: string): void {
  if (!/^https?:/iu.test(raw)) return;
  if (!/^https?:\/\/[^/?#\s]+(?:[/?#]|$)/iu.test(raw)) {
    throw new Error(`configured Nix substituter is malformed: ${nixCacheSubstituterIdentity(raw)}`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`configured Nix substituter is malformed: ${nixCacheSubstituterIdentity(raw)}`);
  }
  const rawKeys = [url.search.slice(1), url.hash.slice(1)]
    .flatMap((part) => part.split("&"))
    .map((part) => part.split("=", 1)[0] || "");
  const ambiguousEncodedKey = rawKeys.some((key) => key.includes("%"));
  const credentialQuery = [...url.searchParams.keys()].some((key) => CREDENTIAL_KEY.test(key));
  const credentialFragment = url.hash
    .slice(1)
    .split("&")
    .some((part) => CREDENTIAL_KEY.test(part.split("=", 1)[0] || ""));
  if (
    url.username ||
    url.password ||
    ambiguousEncodedKey ||
    credentialQuery ||
    credentialFragment
  ) {
    throw new Error(
      `configured Nix substituter embeds credentials in its URL; use netrc-file authentication: ${nixCacheSubstituterIdentity(raw)}`,
    );
  }
}

export function assertSafeNixCacheConfig(config: string): void {
  const parsed = parseNixCacheConfigValues(config);
  for (const substituter of [
    ...(parsed.get("substituters") || []),
    ...(parsed.get("extra-substituters") || []),
  ]) {
    assertSafeProbeableNixCacheUrl(substituter);
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
    return `required cache policy failed for unavailable substituter(s): ${unavailable.join(", ")}`;
  }
  return `local fallback is active; unavailable substituter(s): ${unavailable.join(", ")}`;
}
