#!/usr/bin/env zx-wrapper
import { executeCloudflarePagesBackendSubmission } from "./cloudflare-pages-control-plane-backend-run";
import { executeAppStoreConnectControlPlaneSubmission } from "./app-store-connect-control-plane-worker";
import { executeCloudflareContainersControlPlaneSubmission } from "./cloudflare-containers-control-plane";
import { executeGooglePlayControlPlaneSubmission } from "./google-play-control-plane-worker";
import { executeKubernetesControlPlaneSubmission } from "./kubernetes-control-plane";
import { executeS3StaticControlPlaneSubmission } from "./s3-static-control-plane";
import { executeVercelControlPlaneSubmission } from "./vercel-control-plane";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { ControlPlaneCredentialDirectory } from "./control-plane-credentials";

type ProviderDispatchInputs = {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
  workerId: string;
  credentialDirectory?: ControlPlaneCredentialDirectory;
  assertCurrentAuthority?: () => Promise<void>;
};

const DISPATCH = {
  "s3-static": executeS3StaticControlPlaneSubmission,
  kubernetes: executeKubernetesControlPlaneSubmission,
  vercel: executeVercelControlPlaneSubmission,
  "app-store-connect": executeAppStoreConnectControlPlaneSubmission,
  "google-play": executeGooglePlayControlPlaneSubmission,
  "cloudflare-containers": executeCloudflareContainersControlPlaneSubmission,
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
