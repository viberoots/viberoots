#!/usr/bin/env zx-wrapper
import type { JwtClaims } from "./deploy-vault-jwt-claims.ts";
import { normalizeReviewedDeployAdminGroups } from "./deployment-admin-keycloak-auth.ts";

function claimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function claimValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function principalEmailFromOidcClaims(claims: JwtClaims): string | undefined {
  for (const candidate of [
    claimText(claims.email),
    claimText(claims.preferred_username),
    claimText(claims.sub),
  ]) {
    if (looksLikeEmail(candidate)) return candidate.toLowerCase();
  }
  return undefined;
}

export function reviewedKeycloakAdminGroupsFromOidcClaims(claims: JwtClaims): string[] {
  return normalizeReviewedDeployAdminGroups(claimValues(claims.groups));
}
