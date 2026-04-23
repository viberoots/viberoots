#!/usr/bin/env zx-wrapper
export type JwtClaims = Record<string, unknown>;

export type ClaimExpectations = {
  issuer: string;
  audience?: string | string[];
  clientId: string;
  boundClaims: Record<string, string>;
};

function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function claimText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function audienceMatches(value: unknown, expected: string | string[]): boolean {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (typeof value === "string") return allowed.includes(value);
  return Array.isArray(value) && value.some((entry) => allowed.includes(String(entry)));
}

export function decodeJwtPayload(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) throw new Error("access token is not a JWT");
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as JwtClaims;
  } catch {
    throw new Error("access token JWT payload is not valid JSON");
  }
}

export function assertJwtClaims(claims: JwtClaims, expected: ClaimExpectations) {
  if (claimText(claims.iss) !== expected.issuer) {
    throw new Error("access token issuer mismatch");
  }
  if (claimText(claims.azp) !== expected.clientId) {
    throw new Error("access token azp claim mismatch");
  }
  if (expected.audience && !audienceMatches(claims.aud, expected.audience)) {
    throw new Error("access token audience mismatch");
  }
  for (const [key, value] of Object.entries(expected.boundClaims)) {
    if (claimText(claims[key]) !== value) {
      throw new Error(`access token bound claim mismatch: ${key}`);
    }
  }
}
