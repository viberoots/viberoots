#!/usr/bin/env zx-wrapper
import {
  writeBackendDeployRecordDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { removeMirrorFile } from "./nixos-shared-host-control-plane-backend-materialize";
import { sanitizedBackendRecord } from "./cloudflare-pages-control-plane-backend-records";

export async function commitCloudflareBackendRecord(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  record: any;
  recordPath: string;
  fencingToken: string;
  expectedCurrentRunId?: string | null;
}) {
  await writeBackendDeployRecordDoc(
    opts.backend,
    sanitizedBackendRecord({
      ...opts.record,
      controlPlane: { ...opts.record.controlPlane, fencingToken: opts.fencingToken },
    }),
    opts.recordPath,
    { expectedCurrentRunId: opts.expectedCurrentRunId },
  );
  await removeMirrorFile(opts.recordPath);
}
