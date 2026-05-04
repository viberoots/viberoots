#!/usr/bin/env zx-wrapper
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import type { VercelDeployment } from "./contract-types";

export type VercelLocalPublishResult = {
  providerReleaseId: string;
  publicUrl: string;
  artifactIdentity: string;
  providerTargetIdentity: string;
};

export function publishVercelPrebuiltLocal(opts: {
  deployment: VercelDeployment;
  artifactIdentity: string;
}): VercelLocalPublishResult {
  const artifactIdentity = opts.artifactIdentity.trim();
  if (!artifactIdentity) {
    throw new Error("vercel local publisher requires an admitted artifact identity");
  }
  const target = opts.deployment.providerTarget;
  const providerReleaseId = fingerprintValue({
    provider: "vercel",
    target: target.providerTargetIdentity,
    artifactIdentity,
  }).slice("sha256:".length, "sha256:".length + 24);
  return {
    providerReleaseId: `vercel-local-${providerReleaseId}`,
    publicUrl: target.canonicalUrl,
    artifactIdentity,
    providerTargetIdentity: target.providerTargetIdentity,
  };
}
