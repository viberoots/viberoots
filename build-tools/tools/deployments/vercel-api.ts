#!/usr/bin/env zx-wrapper
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint.ts";

export type VercelApiDeployRequest = {
  team: string;
  project: string;
  environment: string;
  artifactIdentity: string;
  outputDir: string;
  sourceRunId?: string;
};

export type VercelApiDeployResult = {
  deploymentId: string;
  url: string;
  aliasAssigned: boolean;
};

export type VercelApiClient = {
  publishPrebuilt(request: VercelApiDeployRequest): Promise<VercelApiDeployResult>;
  cleanupPreview?(request: { team: string; project: string; sourceRunId: string }): Promise<{
    deploymentId: string;
    cleaned: boolean;
  }>;
};

function stableDeploymentId(request: VercelApiDeployRequest): string {
  return fingerprintValue({
    provider: "vercel",
    team: request.team,
    project: request.project,
    environment: request.environment,
    artifactIdentity: request.artifactIdentity,
    sourceRunId: request.sourceRunId || "",
  }).slice("sha256:".length, "sha256:".length + 24);
}

export function createFakeVercelApiClient(): VercelApiClient {
  return {
    async publishPrebuilt(request) {
      const suffix = stableDeploymentId(request);
      return {
        deploymentId: `dpl_${suffix}`,
        url: `https://${request.project}-${suffix.slice(0, 8)}.vercel.app/`,
        aliasAssigned: request.environment !== "preview",
      };
    },
    async cleanupPreview(request) {
      const suffix = fingerprintValue(request).slice("sha256:".length, "sha256:".length + 16);
      return { deploymentId: `dpl_${suffix}`, cleaned: true };
    },
  };
}
