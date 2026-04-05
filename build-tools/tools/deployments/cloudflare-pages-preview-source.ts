#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  resolveCloudflarePagesReplaySource,
  type CloudflarePagesReplaySnapshot,
} from "./cloudflare-pages-replay.ts";
import {
  readCloudflarePagesDeployRecord,
  type CloudflarePagesDeployRecord,
} from "./cloudflare-pages-records.ts";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts.ts";

export type CloudflarePagesPreviewSourceSelection = {
  operationKind: "deploy";
  deployment: CloudflarePagesDeployment;
  artifact: AdmittedStaticWebappArtifact;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  sourceRecordPath: string;
  sourceReplaySnapshotPath: string;
  sourceRecord: CloudflarePagesDeployRecord;
  sourceReplaySnapshot: CloudflarePagesReplaySnapshot;
};

function sameDeploymentPreviewErrors(
  deployment: CloudflarePagesDeployment,
  sourceDeployment: CloudflarePagesDeployment,
): string[] {
  const errors: string[] = [];
  if (sourceDeployment.deploymentId !== deployment.deploymentId) {
    errors.push(
      `preview source run must belong to ${deployment.deploymentId}, got ${sourceDeployment.deploymentId}`,
    );
  }
  if (sourceDeployment.component.kind !== deployment.component.kind) {
    errors.push(
      `component kind mismatch: current=${deployment.component.kind} source=${sourceDeployment.component.kind}`,
    );
  }
  if (sourceDeployment.component.target !== deployment.component.target) {
    errors.push(
      `component target mismatch: current=${deployment.component.target} source=${sourceDeployment.component.target}`,
    );
  }
  if (
    sourceDeployment.providerTarget.providerTargetIdentity !==
    deployment.providerTarget.providerTargetIdentity
  ) {
    errors.push(
      `provider target mismatch: current=${deployment.providerTarget.providerTargetIdentity} source=${sourceDeployment.providerTarget.providerTargetIdentity}`,
    );
  }
  return errors;
}

function previewSourceEligibilityErrors(record: CloudflarePagesDeployRecord): string[] {
  const errors: string[] = [];
  if (record.finalOutcome !== "succeeded") {
    errors.push(`source run is not successful: ${record.finalOutcome}`);
  }
  if (record.publishMode !== "normal") {
    errors.push(`preview source must use publish_mode normal, got ${record.publishMode}`);
  }
  if (record.operationKind === "preview_cleanup") {
    errors.push("preview cleanup records cannot be reused as preview sources");
  }
  return errors;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveCloudflarePagesPreviewSelection(opts: {
  deployment: CloudflarePagesDeployment;
  recordsRoot: string;
  sourceRunId: string;
}): Promise<CloudflarePagesPreviewSourceSelection> {
  const source = await resolveCloudflarePagesReplaySource({
    recordsRoot: opts.recordsRoot,
    deployRunId: opts.sourceRunId,
  });
  const errors = [
    ...sameDeploymentPreviewErrors(opts.deployment, source.replaySnapshot.deployment),
    ...previewSourceEligibilityErrors(source.record),
  ];
  if (errors.length > 0) {
    throw new Error(`preview source run is not eligible: ${source.record.deployRunId}
${errors.join("\n")}`);
  }
  return {
    operationKind: "deploy",
    deployment: opts.deployment,
    artifact: source.replaySnapshot.artifact,
    parentRunId: source.record.deployRunId,
    releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
    artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
    sourceRecordPath: source.recordPath,
    sourceReplaySnapshotPath: source.record.replaySnapshotPath || "",
    sourceRecord: source.record,
    sourceReplaySnapshot: source.replaySnapshot,
  };
}

export async function findLatestCloudflarePagesPreviewRecord(opts: {
  recordsRoot: string;
  deployment: CloudflarePagesDeployment;
  sourceRunId: string;
}): Promise<CloudflarePagesDeployRecord | undefined> {
  const runsDir = path.join(path.resolve(opts.recordsRoot), "runs");
  if (!(await pathExists(runsDir))) return undefined;
  for (const name of (await fsp.readdir(runsDir)).sort().reverse()) {
    const record = await readCloudflarePagesDeployRecord(path.join(runsDir, name));
    if (record.deploymentId !== opts.deployment.deploymentId) continue;
    if (record.publishMode !== "preview") continue;
    if (record.operationKind === "preview_cleanup") continue;
    if (record.previewIdentitySelector?.kind !== "source_run") continue;
    if (record.previewIdentitySelector.sourceRunId !== opts.sourceRunId) continue;
    return record;
  }
  return undefined;
}
