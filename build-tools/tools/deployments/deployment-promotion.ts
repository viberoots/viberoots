#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { DeploymentTarget } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import type { CloudflarePagesDeployRecord } from "./cloudflare-pages-records.ts";
import {
  resolveCloudflarePagesReplaySource,
  type CloudflarePagesReplaySnapshot,
} from "./cloudflare-pages-replay.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";
import {
  resolveNixosSharedHostReplaySource,
  type NixosSharedHostReplaySnapshot,
} from "./nixos-shared-host-replay.ts";
import type { AdmittedStaticWebappArtifact } from "./static-webapp-artifacts.ts";

export type DeploymentPromotionSourceRecord =
  | CloudflarePagesDeployRecord
  | NixosSharedHostDeployRecord;

export type DeploymentPromotionSourceReplaySnapshot =
  | CloudflarePagesReplaySnapshot
  | NixosSharedHostReplaySnapshot;

export type DeploymentPromotionSource = {
  record: DeploymentPromotionSourceRecord;
  recordPath: string;
  replaySnapshot: DeploymentPromotionSourceReplaySnapshot;
  replaySnapshotPath: string;
  artifact: AdmittedStaticWebappArtifact;
};

export type CrossDeploymentPromotionSelection<TDeployment extends DeploymentTarget> = {
  operationKind: "promotion";
  deployment: TDeployment;
  artifact: AdmittedStaticWebappArtifact;
  parentRunId: string;
  releaseLineageId: string;
  artifactLineageId: string;
  sourceRecordPath: string;
  sourceReplaySnapshotPath: string;
  sourceRecord: DeploymentPromotionSourceRecord;
  sourceReplaySnapshot: DeploymentPromotionSourceReplaySnapshot;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  }
  return String((out as any).stdout || "").trim();
}

function sourceStage(source: DeploymentPromotionSource): string {
  return source.replaySnapshot.deployment.environmentStage;
}

function sourceRevision(source: DeploymentPromotionSource): string {
  return source.replaySnapshot.admittedContext.source.sourceRevision;
}

function defaultRecordsRoots(workspaceRoot: string, recordsRoot: string): string[] {
  return Array.from(
    new Set([
      path.resolve(recordsRoot),
      path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host", "records"),
      path.join(workspaceRoot, ".local", "deployments", "cloudflare-pages", "records"),
    ]),
  );
}

async function resolvePromotionSourceByPath(
  recordPath: string,
): Promise<DeploymentPromotionSource> {
  const raw = JSON.parse(await fsp.readFile(recordPath, "utf8")) as { provider?: string };
  if (raw.provider === "nixos-shared-host") {
    const source = await resolveNixosSharedHostReplaySource({ recordPath });
    return {
      record: source.record,
      recordPath: source.recordPath,
      replaySnapshot: source.replaySnapshot,
      replaySnapshotPath: source.record.replaySnapshotPath || "",
      artifact: source.replaySnapshot.artifact,
    };
  }
  if (raw.provider === "cloudflare-pages") {
    const source = await resolveCloudflarePagesReplaySource({ recordPath });
    return {
      record: source.record,
      recordPath: source.recordPath,
      replaySnapshot: source.replaySnapshot,
      replaySnapshotPath: source.record.replaySnapshotPath || "",
      artifact: source.replaySnapshot.artifact,
    };
  }
  throw new Error(`unsupported promotion source record: ${recordPath}`);
}

export async function resolveDeploymentPromotionSource(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  sourceRunId: string;
}): Promise<DeploymentPromotionSource> {
  for (const root of defaultRecordsRoots(opts.workspaceRoot, opts.recordsRoot)) {
    const recordPath = path.join(root, "runs", `${opts.sourceRunId}.json`);
    if (await pathExists(recordPath)) return await resolvePromotionSourceByPath(recordPath);
  }
  throw new Error(`promotion source run not found: ${opts.sourceRunId}`);
}

function compatibilityErrors(
  deployment: DeploymentTarget,
  source: DeploymentPromotionSource,
): string[] {
  const sourceDeployment = source.replaySnapshot.deployment;
  const errors: string[] = [];
  if (source.record.finalOutcome !== "succeeded") {
    errors.push(`source run is not successful: ${source.record.finalOutcome}`);
  }
  if (source.record.deploymentId === deployment.deploymentId) {
    errors.push(`promotion requires a distinct target deployment id: ${deployment.deploymentId}`);
  }
  if (sourceDeployment.lanePolicyRef !== deployment.lanePolicyRef) {
    errors.push(
      `lanePolicyRef mismatch: current=${deployment.lanePolicyRef} source=${sourceDeployment.lanePolicyRef}`,
    );
  }
  if (
    source.replaySnapshot.admittedContext.lanePolicyFingerprint !==
    deployment.lanePolicy.fingerprint
  ) {
    errors.push(
      `lanePolicyFingerprint mismatch: current=${deployment.lanePolicy.fingerprint} source=${source.replaySnapshot.admittedContext.lanePolicyFingerprint}`,
    );
  }
  if (deployment.lanePolicy.artifactReuseMode !== "same_artifact") {
    errors.push(
      `target lane artifact_reuse_mode must be same_artifact, got ${deployment.lanePolicy.artifactReuseMode}`,
    );
  }
  if (sourceDeployment.lanePolicy.artifactReuseMode !== "same_artifact") {
    errors.push(
      `source lane artifact_reuse_mode must be same_artifact, got ${sourceDeployment.lanePolicy.artifactReuseMode}`,
    );
  }
  const edge = `${sourceStage(source)}->${deployment.environmentStage}`;
  if (!deployment.lanePolicy.allowedPromotionEdges.includes(edge)) {
    errors.push(`promotion edge is not allowed by the current lane policy: ${edge}`);
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
  return errors;
}

async function eligibilityErrors(
  workspaceRoot: string,
  deployment: DeploymentTarget,
  source: DeploymentPromotionSource,
): Promise<string[]> {
  const targetRef = requiredDeploymentStageBranch(deployment);
  const errors: string[] = [];
  if (!deployment.admissionPolicy.allowedRefs.includes(targetRef)) {
    errors.push(
      `deployment admission policy ${deployment.admissionPolicyRef} does not allow source ref ${targetRef}`,
    );
  }
  const targetRevision = await gitStdout(workspaceRoot, ["rev-parse", targetRef]);
  if (targetRevision !== sourceRevision(source)) {
    errors.push(
      `source run no longer matches current promotable target state: ${source.record.deployRunId}`,
    );
  }
  return errors;
}

export async function resolveCrossDeploymentPromotionSelection<
  TDeployment extends DeploymentTarget,
>(opts: {
  workspaceRoot: string;
  deployment: TDeployment;
  recordsRoot: string;
  sourceRunId: string;
}): Promise<CrossDeploymentPromotionSelection<TDeployment>> {
  const source = await resolveDeploymentPromotionSource(opts);
  const errors = [
    ...compatibilityErrors(opts.deployment, source),
    ...(await eligibilityErrors(opts.workspaceRoot, opts.deployment, source)),
  ];
  if (errors.length > 0) {
    throw new Error(`promotion source run is not eligible: ${source.record.deployRunId}
${errors.join("\n")}`);
  }
  return {
    operationKind: "promotion",
    deployment: opts.deployment,
    artifact: source.artifact,
    parentRunId: source.record.deployRunId,
    releaseLineageId: source.record.releaseLineageId || source.record.deployRunId,
    artifactLineageId: source.record.artifactLineageId || source.replaySnapshot.artifact.identity,
    sourceRecordPath: source.recordPath,
    sourceReplaySnapshotPath: source.replaySnapshotPath,
    sourceRecord: source.record,
    sourceReplaySnapshot: source.replaySnapshot,
  };
}
