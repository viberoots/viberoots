#!/usr/bin/env zx-wrapper
import { executeCloudflarePagesBackendSubmission } from "./cloudflare-pages-control-plane-backend-run";
import { executeKubernetesControlPlaneSubmission } from "./kubernetes-control-plane";
import { executeS3StaticControlPlaneSubmission } from "./s3-static-control-plane";
import { executeVercelControlPlaneSubmission } from "./vercel-control-plane";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";

type ProviderDispatchInputs = {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
  workerId: string;
  assertCurrentAuthority?: () => Promise<void>;
};

const DISPATCH = {
  "s3-static": executeS3StaticControlPlaneSubmission,
  kubernetes: executeKubernetesControlPlaneSubmission,
  vercel: executeVercelControlPlaneSubmission,
} as const;

export async function dispatchProviderControlPlaneSubmission(
  provider: string,
  inputs: ProviderDispatchInputs,
): Promise<boolean> {
  const handler = DISPATCH[provider as keyof typeof DISPATCH];
  if (handler) {
    await handler(inputs);
    return true;
  }
  return false;
}

export { executeCloudflarePagesBackendSubmission };
