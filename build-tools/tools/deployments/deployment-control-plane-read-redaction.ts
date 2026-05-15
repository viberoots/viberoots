#!/usr/bin/env zx-wrapper

const SECRET_KEY_PATTERN =
  /(secret|token|password|authorization|credential|private.?key|clientSecret)/i;
const SECRET_VALUE_PATTERN =
  /(bearer\s+\S+|sk_live_\S+|token=\S+|password=\S+|client[_-]?secret=\S+|-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----)/gi;
const RAW_ENV_KEY_PATTERN =
  /^(rawEnv|rawEnvironment|environmentDump|envDump|env|environmentVariables)$/i;
const ARTIFACT_CONTENT_KEY_PATTERN =
  /^(artifactContents?|artifactPayload|artifactBody|artifactBytes|contents?|payload|body|bytes)$/i;
const SAFE_REFERENCE_KEYS = new Set(["admittedSecretReferences"]);

export function redactControlPlaneReadModel<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return redactObject(value as Record<string, unknown>);
  if (typeof value === "string") return value.replace(SECRET_VALUE_PATTERN, "<redacted>");
  return value;
}

function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SAFE_REFERENCE_KEYS.has(key)) {
      out[key] = redactValue(child);
      continue;
    }
    if (SECRET_KEY_PATTERN.test(key) || RAW_ENV_KEY_PATTERN.test(key)) {
      out[key] = redactedShape(child);
      continue;
    }
    if (ARTIFACT_CONTENT_KEY_PATTERN.test(key) && hasArtifactSibling(value, key)) {
      out[key] = redactedShape(child);
      continue;
    }
    out[key] = redactValue(child);
  }
  return out;
}

function redactedShape(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) return value.length > 0 ? ["<redacted>"] : [];
  if (typeof value === "object") return "<redacted>";
  return "<redacted>";
}

function hasArtifactSibling(value: Record<string, unknown>, currentKey: string): boolean {
  return Object.keys(value).some(
    (key) => key !== currentKey && /artifact|identity|objectKey|digest|contentType/i.test(key),
  );
}
