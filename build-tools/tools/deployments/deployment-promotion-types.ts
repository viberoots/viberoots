#!/usr/bin/env zx-wrapper
import type { AdmittedMobileAppArtifact } from "./app-store-connect-artifacts.ts";
import type { AppStoreConnectDeployRecord } from "./app-store-connect-records.ts";
import type { AppStoreConnectReplaySnapshot } from "./app-store-connect-replay.ts";
import type { DeploymentTarget } from "./contract.ts";
import type { CloudflarePagesDeployRecord } from "./cloudflare-pages-records.ts";
import type { CloudflarePagesReplaySnapshot } from "./cloudflare-pages-replay.ts";
import type { AdmittedGooglePlayArtifact } from "./google-play-artifacts.ts";
import type { GooglePlayDeployRecord } from "./google-play-records.ts";
import type { GooglePlayReplaySnapshot } from "./google-play-replay.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay.ts";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts.ts";

export type PromotionArtifact =
  | AdmittedMobileAppArtifact
  | AdmittedGooglePlayArtifact
  | AdmittedStaticWebappArtifact;

export type DeploymentPromotionSourceRecord =
  | AppStoreConnectDeployRecord
  | GooglePlayDeployRecord
  | CloudflarePagesDeployRecord
  | NixosSharedHostDeployRecord;

export type DeploymentPromotionSourceReplaySnapshot =
  | AppStoreConnectReplaySnapshot
  | GooglePlayReplaySnapshot
  | CloudflarePagesReplaySnapshot
  | NixosSharedHostReplaySnapshot;

export type DeploymentPromotionSource = {
  record: DeploymentPromotionSourceRecord;
  recordPath: string;
  replaySnapshot: DeploymentPromotionSourceReplaySnapshot;
  replaySnapshotPath: string;
  artifact?: PromotionArtifact;
  artifactIdentity: string;
};

export type CrossDeploymentPromotionSelection<TDeployment extends DeploymentTarget> = {
  operationKind: "promotion";
  deployment: TDeployment;
  artifact: PromotionArtifact;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  sourceRecordPath: string;
  sourceReplaySnapshotPath: string;
  sourceRecord: DeploymentPromotionSourceRecord;
  sourceReplaySnapshot: DeploymentPromotionSourceReplaySnapshot;
};

export type CrossDeploymentPromotionSourceSelection<TDeployment extends DeploymentTarget> = Omit<
  CrossDeploymentPromotionSelection<TDeployment>,
  "artifact" | "artifactLineageId"
>;
