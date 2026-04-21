#!/usr/bin/env zx-wrapper
import { providerTargetIdentityFor, type DeploymentTarget } from "./contract.ts";
import type { JwtClaims } from "./deploy-vault-jwt-claims.ts";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import type {
  DeploymentControlPlaneAuthorization,
  DeploymentControlPlaneGrant,
  DeploymentControlPlaneRole,
} from "./deployment-control-plane-contract.ts";

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

function roleForOperation(operationKind: string): DeploymentControlPlaneRole {
  if (operationKind === "approve") return "approver";
  if (["cancel", "resume", "abort"].includes(operationKind)) return "operator";
  return operationKind === "explicit_removal" ||
    operationKind === "preview_cleanup" ||
    operationKind === "retire_target" ||
    operationKind === "migrate_target"
    ? "operator"
    : "submitter";
}

function grantFor(
  deployment: DeploymentTarget,
  operationKind: string,
): DeploymentControlPlaneGrant {
  const role = roleForOperation(operationKind);
  return role === "operator"
    ? {
        role,
        scope: { kind: "provider_target_identity", value: providerTargetIdentityFor(deployment) },
      }
    : { role, scope: { kind: "deployment_id", value: deployment.deploymentId } };
}

export function authorizationForOidcPrincipal(opts: {
  deployment: DeploymentTarget;
  operationKind: string;
  principal: DeploymentPrincipal;
}): DeploymentControlPlaneAuthorization {
  return {
    requestedBy: opts.principal,
    grants: [grantFor(opts.deployment, opts.operationKind)],
  };
}

export function assertNonceIfPresent(claims: JwtClaims, nonce: string) {
  const claim = claimText(claims.nonce);
  if (claim && claim !== nonce) throw new Error("OIDC callback nonce mismatch");
}
