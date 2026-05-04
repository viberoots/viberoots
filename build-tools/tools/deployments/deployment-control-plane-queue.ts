#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store";
import type { ControlPlaneLockAbortReason } from "./nixos-shared-host-control-plane-store";

type SubmissionLike = {
  submissionId: string;
  submittedAt: string;
  deploymentId: string;
  lockScope: string;
  lifecycleState: string;
  terminationReason?: string | null;
  executionSnapshotPath: string;
  completedAt?: string;
};

type SnapshotLike = {
  submissionId: string;
  submittedAt: string;
  operationKind: string;
  deploymentId: string;
  lockScope: string;
  action?: {
    kind?: string;
    publishBehavior?: string;
    publishMode?: string;
    previewIdentitySelector?: { sourceRunId?: string };
  };
};

function submissionsDir(recordsRoot: string): string {
  return path.join(path.resolve(recordsRoot), "control-plane", "submissions");
}

function activeQueueState(lifecycleState: string): boolean {
  return lifecycleState === "queued" || lifecycleState === "waiting_for_lock";
}

function autoSupersedableNormalDeploy(snapshot: SnapshotLike): boolean {
  return (
    snapshot.operationKind === "deploy" &&
    snapshot.action?.kind === "deploy" &&
    snapshot.action.publishBehavior === "deploy" &&
    (snapshot.action.publishMode || "normal") === "normal"
  );
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function lockWaitAbortReasonForSubmission(
  submissionPath: string,
): Promise<ControlPlaneLockAbortReason | null> {
  const submission = await readJson<SubmissionLike>(submissionPath);
  if (!submission) return "no_longer_admitted";
  if (submission.lifecycleState === "cancelled" || submission.terminationReason === "cancelled") {
    return "cancelled";
  }
  if (submission.terminationReason === "superseded") return "superseded";
  if (submission.terminationReason === "no_longer_admitted") return "no_longer_admitted";
  return null;
}

export async function supersedeOlderQueuedRuns(opts: {
  recordsRoot: string;
  submissionPath: string;
  snapshot: SnapshotLike;
}): Promise<void> {
  if (!autoSupersedableNormalDeploy(opts.snapshot)) return;
  const dir = submissionsDir(opts.recordsRoot);
  const entries = await fsp.readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(dir, entry);
    if (path.resolve(filePath) === path.resolve(opts.submissionPath)) continue;
    const submission = await readJson<SubmissionLike>(filePath);
    if (!submission || !activeQueueState(submission.lifecycleState)) continue;
    if (
      submission.deploymentId !== opts.snapshot.deploymentId ||
      submission.lockScope !== opts.snapshot.lockScope
    ) {
      continue;
    }
    const snapshot = await readJson<SnapshotLike>(submission.executionSnapshotPath);
    if (!snapshot || !autoSupersedableNormalDeploy(snapshot)) continue;
    const samePreviewIdentity =
      snapshot.action?.previewIdentitySelector?.sourceRunId ===
      opts.snapshot.action?.previewIdentitySelector?.sourceRunId;
    if (
      (snapshot.action?.publishMode || "normal") !== (opts.snapshot.action?.publishMode || "normal")
    ) {
      continue;
    }
    if ((snapshot.action?.publishMode || "normal") === "preview" && !samePreviewIdentity) {
      continue;
    }
    if (Date.parse(snapshot.submittedAt) > Date.parse(opts.snapshot.submittedAt)) continue;
    await writeControlPlaneJson(filePath, {
      ...submission,
      lifecycleState: "finished",
      terminationReason: "superseded",
      completedAt: new Date().toISOString(),
    });
  }
}

export async function queueSubmissionForLock<T extends SubmissionLike>(opts: {
  recordsRoot: string;
  submissionPath: string;
  snapshot: SnapshotLike;
  submission: T;
}): Promise<T> {
  await writeControlPlaneJson(opts.submissionPath, opts.submission);
  await supersedeOlderQueuedRuns({
    recordsRoot: opts.recordsRoot,
    submissionPath: opts.submissionPath,
    snapshot: opts.snapshot,
  });
  const waiting = { ...opts.submission, lifecycleState: "waiting_for_lock" };
  await writeControlPlaneJson(opts.submissionPath, waiting);
  return waiting;
}
