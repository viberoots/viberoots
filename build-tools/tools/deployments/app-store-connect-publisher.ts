#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { AppStoreConnectDeployment } from "./contract";

export type AppStoreConnectTrackState = {
  track: AppStoreConnectDeployment["providerTarget"]["track"];
  status: "uploaded" | "staged" | "released";
  promotedFromTrack?: string;
};

export type AppStoreConnectRolloutState = {
  mode: "all_at_once" | "store_staged";
  state: "completed";
  stagesCompleted: number;
};

export type AppStoreConnectReleaseHealth = {
  status: "healthy" | "failed";
  processingStatus: "processed" | "failed";
  installable: boolean;
  evidence: string[];
};

export type AppStoreConnectPublishResult = {
  storeSubmissionId: string;
  providerReleaseId: string;
  trackState: AppStoreConnectTrackState;
  rolloutState: AppStoreConnectRolloutState;
  releaseHealth: AppStoreConnectReleaseHealth;
};

function fakeStoreRoot(workspaceRoot: string): string {
  return path.resolve(
    process.env.VBR_APP_STORE_CONNECT_FAKE_STORE_ROOT?.trim() ||
      path.join(workspaceRoot, ".local", "deployments", "app-store-connect", "fake-store"),
  );
}

function trackStateFor(deployment: AppStoreConnectDeployment, sourceTrack?: string) {
  return {
    track: deployment.providerTarget.track,
    status: deployment.providerTarget.track === "app-store" ? "released" : "staged",
    ...(sourceTrack && sourceTrack !== deployment.providerTarget.track
      ? { promotedFromTrack: sourceTrack }
      : {}),
  } satisfies AppStoreConnectTrackState;
}

export async function publishAppStoreConnectMobileApp(opts: {
  workspaceRoot: string;
  deployment: AppStoreConnectDeployment;
  artifactPath: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  sourceTrack?: string;
}): Promise<AppStoreConnectPublishResult> {
  const storeSubmissionId = `asc-submit-${crypto.randomBytes(4).toString("hex")}`;
  const providerReleaseId = `asc-release-${crypto.randomBytes(4).toString("hex")}`;
  const releaseRoot = path.join(
    fakeStoreRoot(opts.workspaceRoot),
    opts.deployment.providerTarget.issuer,
    opts.deployment.providerTarget.app,
    opts.deployment.providerTarget.track,
    providerReleaseId,
  );
  await fsp.mkdir(releaseRoot, { recursive: true });
  await fsp.copyFile(opts.artifactPath, path.join(releaseRoot, path.basename(opts.artifactPath)));
  const rolloutMode =
    opts.deployment.rolloutPolicy?.mode === "store_staged" ? "store_staged" : "all_at_once";
  const releaseHealthMode = process.env.VBR_APP_STORE_CONNECT_FAKE_RELEASE_HEALTH_MODE?.trim();
  const releaseHealth: AppStoreConnectReleaseHealth =
    releaseHealthMode === "failed"
      ? {
          status: "failed",
          processingStatus: "failed",
          installable: false,
          evidence: ["upload_received", "processing_failed"],
        }
      : {
          status: "healthy",
          processingStatus: "processed",
          installable: true,
          evidence:
            rolloutMode === "store_staged"
              ? ["upload_received", "processing_succeeded", "installable", "staged_rollout_healthy"]
              : ["upload_received", "processing_succeeded", "installable"],
        };
  return {
    storeSubmissionId,
    providerReleaseId,
    trackState: trackStateFor(opts.deployment, opts.sourceTrack),
    rolloutState: {
      mode: rolloutMode,
      state: "completed",
      stagesCompleted: rolloutMode === "store_staged" ? 2 : 1,
    },
    releaseHealth,
  };
}

export function assertHealthyAppStoreConnectRelease(result: AppStoreConnectPublishResult): void {
  if (
    result.releaseHealth.status !== "healthy" ||
    result.releaseHealth.processingStatus !== "processed" ||
    !result.releaseHealth.installable
  ) {
    throw new Error(
      `release_health validation failed: status=${result.releaseHealth.status} processing=${result.releaseHealth.processingStatus} installable=${String(result.releaseHealth.installable)}`,
    );
  }
}
