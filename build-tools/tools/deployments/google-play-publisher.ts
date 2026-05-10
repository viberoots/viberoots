#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { GooglePlayDeployment } from "./contract";

export type GooglePlayTrackState = {
  track: GooglePlayDeployment["providerTarget"]["track"];
  status: "uploaded" | "staged" | "released";
  promotedFromTrack?: string;
};

export type GooglePlayRolloutState = {
  mode: "all_at_once" | "store_staged";
  state: "completed";
  stagesCompleted: number;
  rolloutFractionPercent: number;
};

export type GooglePlayReleaseHealth = {
  status: "healthy" | "failed";
  processingStatus: "processed" | "failed";
  installable: boolean;
  evidence: string[];
};

export type GooglePlayPublishResult = {
  storeSubmissionId: string;
  providerReleaseId: string;
  trackState: GooglePlayTrackState;
  rolloutState: GooglePlayRolloutState;
  releaseHealth: GooglePlayReleaseHealth;
};

function fakeStoreRoot(workspaceRoot: string): string {
  return path.resolve(
    process.env.VBR_GOOGLE_PLAY_FAKE_STORE_ROOT?.trim() ||
      path.join(workspaceRoot, ".local", "deployments", "google-play", "fake-store"),
  );
}

function trackStateFor(
  deployment: GooglePlayDeployment,
  sourceTrack?: string,
): GooglePlayTrackState {
  return {
    track: deployment.providerTarget.track,
    status: deployment.providerTarget.track === "production" ? "released" : "staged",
    ...(sourceTrack && sourceTrack !== deployment.providerTarget.track
      ? { promotedFromTrack: sourceTrack }
      : {}),
  };
}

export async function publishGooglePlayMobileApp(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  artifactPath: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  sourceTrack?: string;
}): Promise<GooglePlayPublishResult> {
  const storeSubmissionId = `gplay-submit-${crypto.randomBytes(4).toString("hex")}`;
  const providerReleaseId = `gplay-release-${crypto.randomBytes(4).toString("hex")}`;
  const releaseRoot = path.join(
    fakeStoreRoot(opts.workspaceRoot),
    opts.deployment.providerTarget.developerAccount,
    opts.deployment.providerTarget.app,
    opts.deployment.providerTarget.track,
    providerReleaseId,
  );
  await fsp.mkdir(releaseRoot, { recursive: true });
  await fsp.copyFile(opts.artifactPath, path.join(releaseRoot, path.basename(opts.artifactPath)));
  const rolloutMode =
    opts.deployment.rolloutPolicy?.mode === "store_staged" ? "store_staged" : "all_at_once";
  const releaseHealthMode = process.env.VBR_GOOGLE_PLAY_FAKE_RELEASE_HEALTH_MODE?.trim();
  const releaseHealth: GooglePlayReleaseHealth =
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
              ? [
                  "upload_received",
                  "processing_succeeded",
                  "installable",
                  "track_progressed",
                  "staged_rollout_healthy",
                ]
              : ["upload_received", "processing_succeeded", "installable", "track_progressed"],
        };
  return {
    storeSubmissionId,
    providerReleaseId,
    trackState: trackStateFor(opts.deployment, opts.sourceTrack),
    rolloutState: {
      mode: rolloutMode,
      state: "completed",
      stagesCompleted: rolloutMode === "store_staged" ? 2 : 1,
      rolloutFractionPercent: rolloutMode === "store_staged" ? 50 : 100,
    },
    releaseHealth,
  };
}

export function assertHealthyGooglePlayRelease(result: GooglePlayPublishResult): void {
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
