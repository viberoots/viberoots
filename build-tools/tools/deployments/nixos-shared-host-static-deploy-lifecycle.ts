#!/usr/bin/env zx-wrapper
import type { DeploymentReleaseAction } from "./deployment-release-actions.ts";
import {
  rethrowAfterNixosSharedHostReleasePhaseFailureWithSecrets,
  runNixosSharedHostReleasePhaseWithSecrets,
  smokeNixosSharedHostPublishedComponentsWithSecrets,
} from "./nixos-shared-host-secret-runtime.ts";
import { runStaticDeployProgressivePhases } from "./nixos-shared-host-static-deploy-progressive.ts";

export async function runNixosSharedHostStaticDeployLifecycle(opts: {
  secretRuntime: {
    enterStep(step: "publish"): Promise<Record<string, string>>;
  };
  runReleasePhase: (
    phase: "pre_publish" | "post_publish_pre_smoke" | "post_smoke",
    extra?: { artifactIdentity?: string; publicUrl?: string },
    executionPath?: "success" | "failure",
  ) => Promise<void>;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  releaseActions: DeploymentReleaseAction[];
  artifactIdentity?: string;
  deployment: any;
  rendered: any;
  hostRoot: string;
  recordsRoot: string;
  deployRunId: string;
  componentArtifacts: any[];
  sourceComponentResults?: any[];
  smokeConnectOverride?: any;
  progressiveRollout?: any;
  gateEvaluator?: any;
  replaySnapshotPath?: string;
  replayState?: any;
  authority: any;
}) {
  const releaseExtra = opts.artifactIdentity
    ? { artifactIdentity: opts.artifactIdentity }
    : undefined;
  await runNixosSharedHostReleasePhaseWithSecrets(
    opts.secretRuntime,
    opts.runReleasePhase,
    opts.operationKind,
    opts.releaseActions,
    "pre_publish",
    releaseExtra,
  ).catch((error) =>
    rethrowAfterNixosSharedHostReleasePhaseFailureWithSecrets(
      opts.secretRuntime,
      opts.runReleasePhase,
      opts.operationKind,
      opts.releaseActions,
      "pre_publish",
      error,
      releaseExtra,
    ),
  );
  await opts.secretRuntime.enterStep("publish");
  const progressive = await runStaticDeployProgressivePhases({
    deployment: opts.deployment,
    rendered: opts.rendered,
    hostRoot: opts.hostRoot,
    recordsRoot: opts.recordsRoot,
    deployRunId: opts.deployRunId,
    operationKind: opts.operationKind,
    releaseActions: opts.releaseActions,
    componentArtifacts: opts.componentArtifacts,
    ...(opts.sourceComponentResults ? { sourceComponentResults: opts.sourceComponentResults } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
    ...(opts.gateEvaluator ? { gateEvaluator: opts.gateEvaluator } : {}),
    ...(opts.replaySnapshotPath ? { replaySnapshotPath: opts.replaySnapshotPath } : {}),
    replayState: opts.replayState,
    authority: opts.authority,
  }).catch((error) =>
    rethrowAfterNixosSharedHostReleasePhaseFailureWithSecrets(
      opts.secretRuntime,
      opts.runReleasePhase,
      opts.operationKind,
      opts.releaseActions,
      "post_publish_pre_smoke",
      error,
      releaseExtra,
    ),
  );
  await runNixosSharedHostReleasePhaseWithSecrets(
    opts.secretRuntime,
    opts.runReleasePhase,
    opts.operationKind,
    opts.releaseActions,
    "post_publish_pre_smoke",
    releaseExtra,
  ).catch((error) =>
    rethrowAfterNixosSharedHostReleasePhaseFailureWithSecrets(
      opts.secretRuntime,
      opts.runReleasePhase,
      opts.operationKind,
      opts.releaseActions,
      "post_publish_pre_smoke",
      error,
      releaseExtra,
    ),
  );
  const smoke = progressive.smoke
    ? progressive.smoke
    : await smokeNixosSharedHostPublishedComponentsWithSecrets({
        secretRuntime: opts.secretRuntime,
        deployment: opts.deployment,
        published: progressive.published,
        ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      }).catch((error) =>
        rethrowAfterNixosSharedHostReleasePhaseFailureWithSecrets(
          opts.secretRuntime,
          opts.runReleasePhase,
          opts.operationKind,
          opts.releaseActions,
          "post_smoke",
          error,
          releaseExtra,
        ),
      );
  await runNixosSharedHostReleasePhaseWithSecrets(
    opts.secretRuntime,
    opts.runReleasePhase,
    opts.operationKind,
    opts.releaseActions,
    "post_smoke",
    {
      ...(releaseExtra || {}),
      ...(smoke.publicUrl ? { publicUrl: smoke.publicUrl } : {}),
    },
    smoke.smokeOutcome === "failed_nonblocking" ? "failure" : "success",
  ).catch((error) =>
    rethrowAfterNixosSharedHostReleasePhaseFailureWithSecrets(
      opts.secretRuntime,
      opts.runReleasePhase,
      opts.operationKind,
      opts.releaseActions,
      "post_smoke",
      error,
      {
        ...(releaseExtra || {}),
        ...(smoke.publicUrl ? { publicUrl: smoke.publicUrl } : {}),
      },
    ),
  );
  return { progressive, smoke };
}
