#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import type { DeploymentTarget } from "./contract";
import type { JwtClaims } from "./deploy-vault-jwt-claims";
import { decodeJwtPayload } from "./deploy-vault-jwt-claims";
import {
  deploymentAuthProjectSlug,
  reviewedHumanGroupName,
  reviewedAutomationGroupName,
} from "./deployment-auth-groups";
import type { DeploymentAuthProviderConfig } from "./deployment-auth-provider-config";
import {
  authorizationForOidcPrincipal,
  principalFromOidcClaims,
} from "./deployment-auth-session-principal";
import { reviewedIdentityAdminGroupsFromOidcClaims } from "./deployment-auth-session-reviewed-identity";

export type DeploymentAuthProviderResult = {
  claims: JwtClaims;
  principal: ReturnType<typeof principalFromOidcClaims>;
  authorization: ReturnType<typeof authorizationForOidcPrincipal>;
  reviewedIdentityAdminGroups: string[];
};

type JwksKey = {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
};

function base64UrlDecode(segment: string): Buffer {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64");
}

function decodeJsonSegment(segment: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(base64UrlDecode(segment).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} is not valid JWT JSON`);
  }
}

function claimText(claims: JwtClaims, name: string): string {
  const value = claims[name];
  return typeof value === "string" ? value.trim() : "";
}

function claimValues(claims: JwtClaims, name: string): string[] {
  const value = claims[name];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function audienceMatches(value: unknown, expected: string[]): boolean {
  if (typeof value === "string") return expected.includes(value);
  return Array.isArray(value) && value.some((entry) => expected.includes(String(entry)));
}

function assertProviderClaims(claims: JwtClaims, config: DeploymentAuthProviderConfig): void {
  const issuer = claimText(claims, "iss");
  if (!issuer) throw new Error("access token missing issuer claim");
  if (issuer !== config.issuer) {
    throw new Error("access token issuer mismatch");
  }
  if (!audienceMatches(claims.aud, config.audience)) {
    throw new Error("access token audience mismatch");
  }
}

function assertTemporalClaims(claims: JwtClaims, nowSeconds: number): void {
  const exp = typeof claims.exp === "number" ? claims.exp : undefined;
  if (!exp) throw new Error("access token missing exp claim");
  if (exp <= nowSeconds) throw new Error("access token expired");
  const nbf = typeof claims.nbf === "number" ? claims.nbf : undefined;
  if (nbf && nbf > nowSeconds) throw new Error("access token not yet valid");
}

function resolveJwksKey(keys: unknown, kid: string): JwksKey {
  if (!Array.isArray(keys)) throw new Error("JWKS response missing keys");
  const key = keys.find((entry) => {
    const candidate = entry as JwksKey;
    return candidate && candidate.kid === kid && candidate.kty === "RSA";
  }) as JwksKey | undefined;
  if (!key) throw new Error("JWKS key not found for token kid");
  if (key.use && key.use !== "sig") throw new Error("JWKS key is not a signing key");
  if (key.alg && key.alg !== "RS256") throw new Error("JWKS key algorithm mismatch");
  return key;
}

function verifyRs256Jwt(token: string, jwk: JwksKey): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("access token is not a signed JWT");
  const header = decodeJsonSegment(parts[0] || "", "access token header");
  if (header.alg !== "RS256") throw new Error("access token algorithm is unsupported");
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const verified = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    base64UrlDecode(parts[2] || ""),
  );
  if (!verified) throw new Error("access token signature verification failed");
  return decodeJwtPayload(token);
}

async function fetchJwks(jwksUrl: string): Promise<Record<string, unknown>> {
  const response = await fetch(jwksUrl);
  if (!response.ok) throw new Error(`JWKS request failed: ${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("JWKS response was not a JSON object");
  }
  return payload as Record<string, unknown>;
}

function mappedGroupClaims(
  config: DeploymentAuthProviderConfig,
  deployment: DeploymentTarget,
  claims: JwtClaims,
): string[] {
  const providerGroups = new Set(claimValues(claims, config.claims.roleClaim));
  const servicePrincipal = claimText(claims, config.claims.servicePrincipalClaim);
  const groups = new Set<string>();
  if (config.roleGroups.deployer.some((group) => providerGroups.has(group))) {
    groups.add(reviewedHumanGroupName(deployment, "submitter"));
    groups.add(reviewedHumanGroupName(deployment, "approver"));
  }
  if (config.roleGroups.admissionReporter.some((group) => providerGroups.has(group))) {
    groups.add(reviewedHumanGroupName(deployment, "admission_reporter"));
  }
  if (config.roleGroups.admin.some((group) => providerGroups.has(group))) {
    groups.add("deploy-admin-identity-membership-admin-global");
  }
  const mappedPrincipal = config.servicePrincipals[servicePrincipal];
  if (mappedPrincipal) {
    groups.add(
      reviewedAutomationGroupName(
        mappedPrincipal,
        "submitter",
        "project",
        deploymentAuthProjectSlug(deployment),
      ),
    );
    groups.add(
      reviewedAutomationGroupName(
        mappedPrincipal,
        "admission_reporter",
        "admission_domain",
        "all-deployments",
      ),
    );
  }
  return [...groups];
}

function providerMappedClaims(
  config: DeploymentAuthProviderConfig,
  deployment: DeploymentTarget,
  claims: JwtClaims,
): JwtClaims {
  const userId = claimText(claims, config.claims.userIdClaim);
  if (!userId) throw new Error("access token missing user id claim");
  const email = claimText(claims, config.claims.emailClaim);
  const servicePrincipal = claimText(claims, config.claims.servicePrincipalClaim);
  const mappedServicePrincipal = servicePrincipal && config.servicePrincipals[servicePrincipal];
  if (claimValues(claims, config.claims.roleClaim).length === 0 && !mappedServicePrincipal) {
    throw new Error("access token missing role claim");
  }
  return {
    ...claims,
    sub: mappedServicePrincipal ? `service-account-${mappedServicePrincipal}` : userId,
    ...(email ? { email } : {}),
    ...(servicePrincipal ? { azp: servicePrincipal } : {}),
    groups: mappedGroupClaims(config, deployment, claims),
  };
}

export async function authenticateDeploymentAuthProviderToken(opts: {
  config: DeploymentAuthProviderConfig;
  deployment: DeploymentTarget;
  token: string;
  now?: Date;
}): Promise<DeploymentAuthProviderResult> {
  if (!opts.config.jwksUrl) throw new Error("auth provider jwksUrl is required");
  const header = decodeJsonSegment(opts.token.split(".")[0] || "", "access token header");
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) throw new Error("access token missing kid header");
  const jwks = await fetchJwks(opts.config.jwksUrl);
  const verifiedClaims = verifyRs256Jwt(opts.token, resolveJwksKey(jwks.keys, kid));
  assertProviderClaims(verifiedClaims, opts.config);
  assertTemporalClaims(verifiedClaims, Math.floor((opts.now || new Date()).getTime() / 1000));
  const claims = providerMappedClaims(opts.config, opts.deployment, verifiedClaims);
  const principal = principalFromOidcClaims(claims);
  return {
    claims,
    principal,
    authorization: authorizationForOidcPrincipal({
      deployment: opts.deployment,
      principal,
      claims,
    }),
    reviewedIdentityAdminGroups: reviewedIdentityAdminGroupsFromOidcClaims(claims),
  };
}

export function authenticateLocalAuthProviderClaims(opts: {
  deployment: DeploymentTarget;
  claims: JwtClaims;
}): DeploymentAuthProviderResult {
  const principal = principalFromOidcClaims(opts.claims);
  return {
    claims: opts.claims,
    principal,
    authorization: authorizationForOidcPrincipal({
      deployment: opts.deployment,
      principal,
      claims: opts.claims,
    }),
    reviewedIdentityAdminGroups: reviewedIdentityAdminGroupsFromOidcClaims(opts.claims),
  };
}
