#!/usr/bin/env zx-wrapper
export const VERCEL_PROVIDER = "vercel";

export type VercelProviderTarget = {
  team: string;
  project: string;
  environment: string;
  canonicalUrl: string;
  providerTargetIdentity: string;
};

export function deriveVercelProviderTarget(input: {
  team: string;
  project: string;
  environment: string;
  canonicalUrl?: string;
}): VercelProviderTarget {
  const team = input.team.trim();
  const project = input.project.trim();
  const environment = input.environment.trim();
  const canonicalUrl = input.canonicalUrl?.trim() || `https://${project}.vercel.app/`;
  return {
    team,
    project,
    environment,
    canonicalUrl,
    providerTargetIdentity: `${VERCEL_PROVIDER}:${team}/${project}#${environment}`,
  };
}
