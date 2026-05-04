#!/usr/bin/env zx-wrapper
import type { JwtClaims } from "./deploy-vault-jwt-claims";
import type { DeploymentPrincipal } from "./deployment-admission-evidence";
import type { DeploymentControlPlaneAuthorization } from "./deployment-control-plane-contract";
import { oidcGrantsForDeployment } from "./deployment-auth-session-grants";
import type { DeploymentTarget } from "./contract";
import { grantsFor } from "./deployment-control-plane-authz";

function claimText(claim: unknown): string {
  return typeof claim === "string" ? claim.trim() : "";
}

export function principalFromOidcClaims(claims: JwtClaims): DeploymentPrincipal {
  const id =
    claimText(claims.sub) ||
    claimText(claims.preferred_username) ||
    claimText(claims.email) ||
    "unknown";
  const displayName = claimText(claims.name) || claimText(claims.preferred_username);
  return {
    principalId: `oidc:${id}`,
    ...(displayName ? { displayName } : {}),
  };
}

export function authorizationForOidcPrincipal(opts: {
  deployment: DeploymentTarget;
  principal: DeploymentPrincipal;
  claims: JwtClaims;
}): DeploymentControlPlaneAuthorization {
  return grantsFor(opts.principal, oidcGrantsForDeployment(opts));
}

export function assertNonceIfPresent(claims: JwtClaims, nonce: string) {
  const claim = claimText(claims.nonce);
  if (claim && claim !== nonce) throw new Error("OIDC callback nonce mismatch");
}
