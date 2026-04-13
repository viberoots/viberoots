#!/usr/bin/env zx-wrapper
import { resolveDeploymentPromotionSource } from "./deployment-promotion-source.ts";

export type ApprovalActionSnapshotLike = {
  action?: {
    parentRunId?: string;
    sourceReplaySnapshotPath?: string;
  };
  paths: { recordsRoot: string };
};

export async function approvalSourceSelection(opts: {
  workspaceRoot: string;
  snapshot: ApprovalActionSnapshotLike;
  backendDatabaseUrl?: string;
}) {
  if (!opts.snapshot.action?.parentRunId) return undefined;
  const source = await resolveDeploymentPromotionSource({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.snapshot.paths.recordsRoot,
    sourceRunId: opts.snapshot.action.parentRunId,
    backendDatabaseUrl: opts.backendDatabaseUrl,
  });
  return {
    record: source.record,
    replaySnapshotPath: source.replaySnapshotPath,
    replaySnapshot: source.replaySnapshot,
  };
}
