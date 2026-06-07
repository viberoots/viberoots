#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import { publishRecordedAppStoreConnectArtifact } from "./app-store-connect-deploy";
import type { AppStoreConnectControlPlaneSnapshot } from "./app-store-connect-control-plane";
import {
  requireFrozenProviderReplaySource,
  requireFrozenProviderSnapshot,
  requireFrozenProviderSubmissionAdmission,
} from "./deployment-provider-frozen-snapshot";
import {
  acquireBackendControlPlaneLock,
  writeBackendDeployRecordDoc,
  writeBackendSubmissionDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store";

export async function executeAppStoreConnectControlPlaneSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
  workerId: string;
  assertCurrentAuthority?: () => Promise<void>;
}) {
  const submission = JSON.parse(await fs.readFile(opts.submissionPath, "utf8"));
  const snapshot = JSON.parse(
    await fs.readFile(opts.executionSnapshotPath, "utf8"),
  ) as AppStoreConnectControlPlaneSnapshot;
  requireFrozenProviderSnapshot(snapshot, "app-store-connect");
  requireFrozenProviderSubmissionAdmission({ provider: "app-store-connect", submission, snapshot });
  if (snapshot.operationKind !== "deploy")
    requireFrozenProviderReplaySource(snapshot, "app-store-connect");
  const lock = await acquireBackendControlPlaneLock(opts.backend, snapshot.lockScope);
  const persist = async (next: Record<string, unknown>) => {
    await lock.assertCurrentAuthority();
    await opts.assertCurrentAuthority?.();
    await writeControlPlaneJson(opts.submissionPath, next);
    await writeBackendSubmissionDoc(opts.backend, next as any, {
      submissionPath: opts.submissionRef,
      executionSnapshotPath: opts.executionSnapshotRef,
    });
  };
  await persist({ ...submission, lifecycleState: "running", workerId: opts.workerId });
  const result = await publishRecordedAppStoreConnectArtifact({
    workspaceRoot: snapshot.workspaceRoot,
    deployment: snapshot.deployment,
    recordsRoot: snapshot.recordsRoot,
    operationKind: snapshot.operationKind,
    artifact: snapshot.artifact,
    admittedContext: snapshot.admittedContext,
    ...(snapshot.parentRunId ? { parentRunId: snapshot.parentRunId } : {}),
    ...(snapshot.releaseLineageId ? { releaseLineageId: snapshot.releaseLineageId } : {}),
    artifactLineageId: snapshot.artifactLineageId,
    ...(snapshot.sourceTrack ? { sourceTrack: snapshot.sourceTrack } : {}),
    providerConfigFingerprint: snapshot.providerConfigFingerprint,
    providerConfigSnapshotPath: snapshot.providerConfigSnapshotPath,
  });
  result.record.controlPlane = {
    submissionId: snapshot.submissionId,
    workerId: opts.workerId,
    admission: "admitted",
    lockScope: snapshot.lockScope,
    fencingToken: lock.fencingToken,
  };
  await lock.assertCurrentAuthority();
  await opts.assertCurrentAuthority?.();
  await writeBackendDeployRecordDoc(opts.backend, result.record, result.recordPath, {
    expectedCurrentRunId: snapshot.expectedCurrentRunId,
  });
  await persist({
    ...submission,
    lifecycleState: "finished",
    completedAt: new Date().toISOString(),
    deployRunId: result.record.deployRunId,
    finalOutcome: result.record.finalOutcome,
  });
}
