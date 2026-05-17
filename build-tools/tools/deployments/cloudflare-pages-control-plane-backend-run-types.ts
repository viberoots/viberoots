#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { ControlPlaneCredentialDirectory } from "./control-plane-credentials";

export type CloudflareBackendRunOpts = {
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
