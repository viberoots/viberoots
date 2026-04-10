#!/usr/bin/env zx-wrapper
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results.ts";
import type { NixosSharedHostSmokeConnectOverride } from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentReleaseAction } from "./deployment-release-actions.ts";
import type { NixosSharedHostGateEvaluator } from "./nixos-shared-host-progressive-execution.ts";
import { runNixosSharedHostProgressiveExecution } from "./nixos-shared-host-progressive-execution.ts";
import type { NixosSharedHostProgressiveRollout } from "./nixos-shared-host-progressive-rollout.ts";
import { primaryNixosSharedHostComponent } from "./nixos-shared-host-components.ts";
import { withFailedStep } from "./nixos-shared-host-deploy-failure.ts";
import { publishNixosSharedHostArtifacts } from "./nixos-shared-host-publish-components.ts";
import {
  createNixosSharedHostDeployRecord,
  type NixosSharedHostDeployRecord,
  writeNixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";
import { staticDeployRecordFields } from "./nixos-shared-host-static-deploy-records.ts";
import { writeNixosSharedHostReplayComponentResults } from "./nixos-shared-host-replay.ts";
import type { NixosSharedHostConfig } from "./nixos-shared-host.ts";

type StaticDeployProgressiveOpts = {
  deployment: NixosSharedHostDeployment;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  recordsRoot: string;
  deployRunId: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  releaseActions: DeploymentReleaseAction[];
  componentArtifacts: NixosSharedHostResolvedComponentArtifact[];
  sourceComponentResults?: NixosSharedHostComponentResult[];
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  progressiveRollout?: NixosSharedHostProgressiveRollout;
  gateEvaluator?: NixosSharedHostGateEvaluator;
  replaySnapshotPath?: string;
  replayState?: Parameters<typeof staticDeployRecordFields>[0];
  authority: any;
};

export async function runStaticDeployProgressivePhases(opts: StaticDeployProgressiveOpts) {
  const allowLiveComponentReuse = opts.releaseActions.length === 0;
  const priorComponentResults = opts.progressiveRollout?.componentResults.length
    ? opts.progressiveRollout.componentResults
    : opts.sourceComponentResults || [];
  const progressive =
    opts.progressiveRollout && opts.componentArtifacts.length > 1
      ? await runNixosSharedHostProgressiveExecution({
          deployment: opts.deployment,
          rendered: opts.rendered,
          hostRoot: opts.hostRoot,
          published: priorComponentResults,
          componentArtifacts: opts.componentArtifacts,
          rollout: opts.progressiveRollout,
          allowLiveComponentReuse,
          ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
          ...(opts.gateEvaluator ? { gateEvaluator: opts.gateEvaluator } : {}),
        })
      : undefined;
  if (progressive?.kind === "pause") {
    if (opts.replaySnapshotPath) {
      await writeNixosSharedHostReplayComponentResults(
        opts.replaySnapshotPath,
        progressive.rollout.componentResults,
        progressive.rollout,
      );
    }
    throw Object.assign(new Error("progressive rollout paused"), {
      paused: true,
      progressiveRollout: progressive.rollout,
    });
  }
  if (progressive?.kind === "abort") {
    const record = createNixosSharedHostDeployRecord(opts.deployment, {
      deployRunId: opts.deployRunId,
      operationKind: opts.operationKind,
      runClassification: opts.operationKind,
      finalOutcome: "aborted",
      ...staticDeployRecordFields({
        ...opts.replayState,
        ...(progressive.rollout ? { progressiveRollout: progressive.rollout } : {}),
      }),
      componentResults: progressive.rollout.componentResults,
      authority: opts.authority,
    });
    const recordPath = await writeNixosSharedHostDeployRecord(opts.recordsRoot, record);
    if (opts.replaySnapshotPath) {
      await writeNixosSharedHostReplayComponentResults(
        opts.replaySnapshotPath,
        progressive.rollout.componentResults,
        progressive.rollout,
      );
    }
    throw Object.assign(new Error("progressive rollout aborted"), {
      record,
      recordPath,
      progressiveRollout: progressive.rollout,
    });
  }
  const published = progressive
    ? progressive.componentResults.map((result) => ({ result }))
    : await publishNixosSharedHostArtifacts({
        deployment: opts.deployment,
        rendered: opts.rendered,
        hostRoot: opts.hostRoot,
        componentArtifacts: opts.componentArtifacts,
        ...(opts.sourceComponentResults
          ? { sourceComponentResults: opts.sourceComponentResults }
          : {}),
        allowLiveComponentReuse,
      }).catch((error) => {
        throw withFailedStep((error as any)?.failedStep || "publish", error);
      });
  const primaryId = primaryNixosSharedHostComponent(opts.deployment).id;
  return {
    progressiveRollout: progressive?.rollout || opts.progressiveRollout,
    published,
    smoke: progressive && {
      componentResults: progressive.componentResults,
      publicUrl: progressive.componentResults.find((result) => result.componentId === primaryId)
        ?.publicUrl,
      healthUrl: progressive.componentResults.find((result) => result.componentId === primaryId)
        ?.healthUrl,
    },
  };
}

export async function failStaticDeployWithRecord(opts: {
  error: unknown;
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  deployRunId: string;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  replaySnapshotPath?: string;
  fallbackArtifactIdentity?: string;
  progressiveRollout?: NixosSharedHostProgressiveRollout;
  replayState?: Parameters<typeof staticDeployRecordFields>[0];
  authority: any;
}) {
  const componentResults = (opts.error as any)?.componentResults as
    | NixosSharedHostComponentResult[]
    | undefined;
  const progressiveRollout =
    ((opts.error as any)?.progressiveRollout as NixosSharedHostProgressiveRollout | undefined) ||
    opts.progressiveRollout;
  if (opts.replaySnapshotPath && componentResults?.length) {
    await writeNixosSharedHostReplayComponentResults(
      opts.replaySnapshotPath,
      componentResults,
      progressiveRollout,
    );
  }
  const failedStep = (await import("./nixos-shared-host-deploy-failure.ts")).failedStepFromError(
    opts.error,
  );
  const finalOutcome = (
    await import("./nixos-shared-host-deploy-failure.ts")
  ).finalOutcomeForFailedStep(failedStep);
  const message = opts.error instanceof Error ? opts.error.message : String(opts.error);
  const record = createNixosSharedHostDeployRecord(opts.deployment, {
    deployRunId: opts.deployRunId,
    operationKind: opts.operationKind,
    runClassification: opts.operationKind,
    finalOutcome,
    ...staticDeployRecordFields({
      ...opts.replayState,
      artifactIdentity: opts.fallbackArtifactIdentity,
      replaySnapshotPath: opts.replaySnapshotPath,
      progressiveRollout,
    }),
    ...(componentResults ? { componentResults } : {}),
    failedStep,
    error: message,
    authority: opts.authority,
  });
  const recordPath = await writeNixosSharedHostDeployRecord(opts.recordsRoot, record);
  throw Object.assign(opts.error instanceof Error ? opts.error : new Error(message), {
    record,
    recordPath,
  });
}
