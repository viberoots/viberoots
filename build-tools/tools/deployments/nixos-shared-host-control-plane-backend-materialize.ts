#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readBackendSnapshotBySubmissionId,
  readBackendSubmissionEnvelopeBySubmissionId,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import type {
  NixosSharedHostControlPlaneSnapshot,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract";
import {
  readControlPlaneJson,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store";

export async function removeMirrorFile(filePath?: string) {
  if (!filePath) return;
  await fsp.rm(filePath, { force: true }).catch(() => {});
}

export async function materializeBackendControlPlaneFiles(
  backend: NixosSharedHostControlPlaneBackendTarget,
  submissionId: string,
) {
  const envelope = await readBackendSubmissionEnvelopeBySubmissionId(backend, submissionId);
  const snapshotEnvelope = await readBackendSnapshotBySubmissionId(backend, submissionId);
  if (!envelope || !snapshotEnvelope) {
    throw new Error(`backend state missing submission or snapshot for ${submissionId}`);
  }
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-control-plane-"));
  const executionSnapshotPath = path.join(tempDir, "snapshot.json");
  const submissionPath = path.join(tempDir, "submission.json");
  await writeControlPlaneJson(
    executionSnapshotPath,
    snapshotEnvelope.snapshot as NixosSharedHostControlPlaneSnapshot,
  );
  await writeControlPlaneJson(submissionPath, {
    ...(envelope.submission as NixosSharedHostControlPlaneSubmission),
    executionSnapshotPath,
  });
  return {
    submissionPath,
    executionSnapshotPath,
    submissionRef: envelope.submissionPath,
    executionSnapshotRef: snapshotEnvelope.executionSnapshotPath,
    cleanup: async () => {
      await fsp.rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function persistMaterializedSubmission(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotRef: string;
}) {
  const submission = await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(
    opts.submissionPath,
  );
  await writeBackendSubmissionDoc(
    opts.backend,
    {
      ...submission,
      executionSnapshotPath: opts.executionSnapshotRef,
    },
    {
      submissionPath: opts.submissionRef,
      executionSnapshotPath: opts.executionSnapshotRef,
    },
  );
}

export async function persistMaterializedSnapshot(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
}) {
  const snapshot = await readControlPlaneJson<NixosSharedHostControlPlaneSnapshot>(
    opts.executionSnapshotPath,
  );
  await writeBackendSnapshotDoc(opts.backend, snapshot, opts.executionSnapshotRef);
}
