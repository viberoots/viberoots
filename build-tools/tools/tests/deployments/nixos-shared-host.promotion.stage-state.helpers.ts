#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  localHarnessControlPlaneDatabaseUrl,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";

type PromotionStageDeployment = {
  deploymentId: string;
  label: string;
  environmentStage: string;
  provider: string;
  lanePolicy: { artifactReuseMode: string };
  providerTarget: { sharedDevTargetIdentity?: string; providerTargetIdentity?: string };
};

function backend(recordsRoot: string) {
  return {
    recordsRoot,
    databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
  };
}

async function writeStageSnapshot(opts: {
  recordsRoot: string;
  submissionId: string;
  deployment: PromotionStageDeployment;
}) {
  await writeBackendSnapshotDoc(
    backend(opts.recordsRoot),
    {
      submissionId: opts.submissionId,
      deployment: {
        environmentStage: opts.deployment.environmentStage,
        lanePolicy: { artifactReuseMode: opts.deployment.lanePolicy.artifactReuseMode },
      },
    } as any,
    path.join(opts.recordsRoot, "snapshots", `${opts.submissionId}.json`),
  );
}

export async function seedCurrentStageState(opts: {
  recordsRoot: string;
  recordPath: string;
  deployment: PromotionStageDeployment;
}) {
  const raw = JSON.parse(await fsp.readFile(opts.recordPath, "utf8"));
  const submissionId = `stage-state-${raw.deployRunId}`;
  await writeStageSnapshot({ ...opts, submissionId });
  await writeBackendDeployRecordDoc(
    backend(opts.recordsRoot),
    {
      ...raw,
      controlPlane: {
        ...(raw.controlPlane || {}),
        submissionId,
      },
    },
    opts.recordPath,
  );
  return backend(opts.recordsRoot).databaseUrl;
}

export async function seedSyntheticTargetStageState(opts: {
  recordsRoot: string;
  deployment: PromotionStageDeployment;
}) {
  const deployRunId = `${opts.deployment.deploymentId}-current`;
  const submissionId = `stage-state-${deployRunId}`;
  const artifactIdentity = "static-webapp:target-bootstrap";
  await writeStageSnapshot({ ...opts, submissionId });
  await writeBackendDeployRecordDoc(
    backend(opts.recordsRoot),
    {
      deployRunId,
      operationKind: "deploy",
      publishMode: "normal",
      finalOutcome: "succeeded",
      deploymentId: opts.deployment.deploymentId,
      deploymentLabel: opts.deployment.label,
      provider: opts.deployment.provider,
      providerTargetIdentity:
        opts.deployment.providerTarget.sharedDevTargetIdentity ||
        opts.deployment.providerTarget.providerTargetIdentity ||
        "",
      artifact: { identity: artifactIdentity },
      artifactLineageId: artifactIdentity,
      admittedContext: {
        source: {
          sourceRef: "main",
          sourceRevision: "target-bootstrap-revision",
          artifactIdentity,
        },
      },
      controlPlane: { submissionId },
    } as any,
    path.join(opts.recordsRoot, "runs", `${deployRunId}.json`),
  );
  return backend(opts.recordsRoot).databaseUrl;
}
