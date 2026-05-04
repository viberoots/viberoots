#!/usr/bin/env zx-wrapper
import { executeCloudflarePagesBackendSubmission } from "./cloudflare-pages-control-plane-backend-run.ts";
import { executeKubernetesControlPlaneSubmission } from "./kubernetes-control-plane.ts";
import { executeS3StaticControlPlaneSubmission } from "./s3-static-control-plane.ts";
import { executeVercelControlPlaneSubmission } from "./vercel-control-plane.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";

type ProviderDispatchInputs = {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
  workerId: string;
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
