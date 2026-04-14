#!/usr/bin/env zx-wrapper
import {
  writeBackendSubmissionDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store.ts";

export type CloudflareBackendSubmissionLike = {
  submissionId: string;
  deployRunId?: string;
  lifecycleState: string;
  lockScope: string;
  executionSnapshotPath: string;
  requestedBy?: { principalId: string; displayName?: string };
  authorization?: unknown;
};

export async function persistCloudflareBackendStatus(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotRef: string;
  submission: CloudflareBackendSubmissionLike;
}) {
  await writeControlPlaneJson(opts.submissionPath, opts.submission);
  await writeBackendSubmissionDoc(
    opts.backend,
    {
      ...opts.submission,
      executionSnapshotPath: opts.executionSnapshotRef,
    },
    {
      submissionPath: opts.submissionRef,
      executionSnapshotPath: opts.executionSnapshotRef,
    },
  );
}
