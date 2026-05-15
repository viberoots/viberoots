#!/usr/bin/env zx-wrapper
import {
  persistMaterializedSnapshot,
  persistMaterializedSubmission,
} from "./nixos-shared-host-control-plane-backend-materialize";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";

export async function runIfCurrentWorkerAuthority(opts: {
  assertCurrentAuthority: () => Promise<void>;
  run: () => Promise<void>;
}) {
  try {
    await opts.assertCurrentAuthority();
  } catch (error) {
    if ((error as { code?: string })?.code !== "worker_ownership_lost") throw error;
    return false;
  }
  await opts.run();
  return true;
}

export async function persistMaterializedControlPlaneFilesIfCurrent(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  materialized: {
    submissionPath: string;
    submissionRef: string;
    executionSnapshotPath: string;
    executionSnapshotRef: string;
  };
  assertCurrentAuthority: () => Promise<void>;
}) {
  return await runIfCurrentWorkerAuthority({
    assertCurrentAuthority: opts.assertCurrentAuthority,
    run: async () => {
      await persistMaterializedSnapshot({
        backend: opts.backend,
        executionSnapshotPath: opts.materialized.executionSnapshotPath,
        executionSnapshotRef: opts.materialized.executionSnapshotRef,
      });
      await persistMaterializedSubmission({
        backend: opts.backend,
        submissionPath: opts.materialized.submissionPath,
        submissionRef: opts.materialized.submissionRef,
        executionSnapshotRef: opts.materialized.executionSnapshotRef,
      });
    },
  });
}
