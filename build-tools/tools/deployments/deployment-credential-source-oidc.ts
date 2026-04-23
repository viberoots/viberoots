#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { assertJwtClaims, decodeJwtPayload, type JwtClaims } from "./deploy-vault-jwt-claims.ts";

export type OidcDiscovery = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceAuthorizationEndpoint?: string;
};

export type HumanClaimRequirement = {
  name: string;
  value?: string | undefined;
};

export function trimIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

export function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function objectFromJson(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} response was not a JSON object`);
  }
  return value as Record<string, unknown>;
}

export async function fetchJsonObject(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = objectFromJson(await response.json(), url);
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : response.status;
    throw new Error(`OIDC request failed for ${url}: ${error}`);
  }
  return payload;
}

export async function discoverOidc(issuerUrl: string): Promise<OidcDiscovery> {
  const issuer = trimIssuer(issuerUrl);
  const metadata = await fetchJsonObject(`${issuer}/.well-known/openid-configuration`);
  if (metadata.issuer !== issuer) throw new Error("OIDC discovery issuer mismatch");
  const tokenEndpoint = typeof metadata.token_endpoint === "string" ? metadata.token_endpoint : "";
  const authorizationEndpoint =
    typeof metadata.authorization_endpoint === "string" ? metadata.authorization_endpoint : "";
  if (!tokenEndpoint) throw new Error("OIDC discovery response missing token_endpoint");
  if (!authorizationEndpoint) {
    throw new Error("OIDC discovery response missing authorization_endpoint");
  }
  const deviceAuthorizationEndpoint =
    typeof metadata.device_authorization_endpoint === "string"
      ? metadata.device_authorization_endpoint
      : undefined;
  return { issuer, authorizationEndpoint, tokenEndpoint, deviceAuthorizationEndpoint };
}

export async function postFormJson(url: string, form: URLSearchParams) {
  return await fetchJsonObject(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
}

export function authorizationUrl(opts: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  verifier: string;
  state: string;
  nonce: string;
  audience?: string | undefined;
}): string {
  const url = new URL(opts.endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("nonce", opts.nonce);
  url.searchParams.set("code_challenge", pkceChallenge(opts.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (opts.audience) url.searchParams.set("audience", opts.audience);
  return url.toString();
}

export async function exchangePkceCodeForToken(opts: {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<string> {
  const payload = await postFormJson(
    opts.tokenEndpoint,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: opts.clientId,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.verifier,
    }),
  );
  const token = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!token) throw new Error("OIDC token endpoint response missing access_token");
  return token;
}

function claimValues(claim: unknown): string[] {
  if (typeof claim === "string") return [claim];
  return Array.isArray(claim)
    ? claim.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function assertHumanClaim(claims: JwtClaims, requirement?: HumanClaimRequirement) {
  if (!requirement?.name) return;
  const values = claimValues(claims[requirement.name]);
  if (requirement.value ? !values.includes(requirement.value) : values.length === 0) {
    throw new Error(`human deploy token missing required claim: ${requirement.name}`);
  }
}

export function validateOidcToken(opts: {
  token: string;
  issuer: string;
  audience?: string | string[] | undefined;
  clientId: string;
  boundClaims: Record<string, string>;
  humanClaim?: HumanClaimRequirement | undefined;
}) {
  const claims = decodeJwtPayload(opts.token);
  assertJwtClaims(claims, {
    issuer: trimIssuer(opts.issuer),
    audience: opts.audience,
    clientId: opts.clientId,
    boundClaims: opts.boundClaims,
  });
  assertHumanClaim(claims, opts.humanClaim);
  return claims;
}
