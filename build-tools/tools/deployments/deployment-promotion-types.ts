#!/usr/bin/env zx-wrapper
import type { AdmittedMobileAppArtifact } from "./app-store-connect-artifacts";
import type { AppStoreConnectDeployRecord } from "./app-store-connect-records";
import type { AppStoreConnectReplaySnapshot } from "./app-store-connect-replay";
import type { DeploymentTarget } from "./contract";
import type { CloudflarePagesDeployRecord } from "./cloudflare-pages-records";
import type { CloudflarePagesReplaySnapshot } from "./cloudflare-pages-replay";
import type { AdmittedGooglePlayArtifact } from "./google-play-artifacts";
import type { GooglePlayDeployRecord } from "./google-play-records";
import type { GooglePlayReplaySnapshot } from "./google-play-replay";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts";

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
  sourceReplaySnapshotPath: string;
  sourceRecord: DeploymentPromotionSourceRecord;
  sourceReplaySnapshot: DeploymentPromotionSourceReplaySnapshot;
};

export type CrossDeploymentPromotionSourceSelection<TDeployment extends DeploymentTarget> = Omit<
  CrossDeploymentPromotionSelection<TDeployment>,
  "artifact" | "artifactLineageId"
>;
