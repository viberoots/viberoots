#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type {
  DeploymentReleaseAction,
  DeploymentReleaseActionReplayContext,
} from "./deployment-release-actions.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";

const RELEASE_ACTION_RESULT_DIR = "release-actions";

function replayContextFor(
  operationKind: "deploy" | "promotion" | "retry" | "rollback",
  publishBehavior?: "deploy" | "publish-only",
): DeploymentReleaseActionReplayContext | undefined {
  if (operationKind === "deploy" && publishBehavior === "publish-only")
    return "deploy_publish_slice";
  return operationKind === "retry" || operationKind === "rollback" || operationKind === "promotion"
    ? operationKind
    : undefined;
}

function rollbackCompatibilityError(action: DeploymentReleaseAction): string | undefined {
  return action.dataCompatibility === "backward_compatible" ||
    action.dataCompatibility === "reversible"
    ? undefined
    : `${action.ref} blocks rollback with data_compatibility=${action.dataCompatibility}`;
}

async function writeReleaseActionMarker(opts: {
  recordsRoot: string;
  deployRunId: string;
  action: DeploymentReleaseAction;
  operationKind: string;
  deployment: NixosSharedHostDeployment;
  artifactIdentity?: string;
  publicUrl?: string;
}) {
  const outputPath = path.join(
    path.resolve(opts.recordsRoot),
    RELEASE_ACTION_RESULT_DIR,
    opts.deployRunId,
    `${opts.action.phase}.${path.basename(opts.action.ref).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`,
  );
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(
    outputPath,
    JSON.stringify(
      {
        actionRef: opts.action.ref,
        type: opts.action.type,
        phase: opts.action.phase,
        operationKind: opts.operationKind,
        deploymentId: opts.deployment.deploymentId,
        providerTargetIdentity: opts.deployment.providerTarget.deploymentTargetIdentity,
        ...(opts.artifactIdentity ? { artifactIdentity: opts.artifactIdentity } : {}),
        ...(opts.publicUrl ? { publicUrl: opts.publicUrl } : {}),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export function rollbackCompatibilityErrors(actions: DeploymentReleaseAction[]): string[] {
  return actions
    .map((action) => rollbackCompatibilityError(action))
    .filter((error): error is string => !!error);
}

export function assertNixosSharedHostReleaseActionPhaseReplayAllowed(opts: {
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  publishBehavior?: "deploy" | "publish-only";
  phase: DeploymentReleaseAction["phase"];
  releaseActions: DeploymentReleaseAction[];
}) {
  const replayContext = replayContextFor(opts.operationKind, opts.publishBehavior);
  if (!replayContext) return;
  for (const action of opts.releaseActions) {
    if (action.phase !== opts.phase || action.runCondition === "failure_only") continue;
    const disposition = action.replayPolicy[replayContext];
    if (disposition === "skip") continue;
    if (disposition === "fail") {
      throw new Error(`release action ${action.ref} does not permit ${replayContext} replay`);
    }
    if (action.duplicateSafety[replayContext] === "not_duplicate_safe") {
      throw new Error(`release action ${action.ref} is not duplicate-safe for ${replayContext}`);
    }
  }
}

export async function runNixosSharedHostReleaseActionPhase(opts: {
  recordsRoot: string;
  deployRunId: string;
  deployment: NixosSharedHostDeployment;
  operationKind: "deploy" | "promotion" | "retry" | "rollback";
  publishBehavior?: "deploy" | "publish-only";
  phase: DeploymentReleaseAction["phase"];
  releaseActions: DeploymentReleaseAction[];
  artifactIdentity?: string;
  publicUrl?: string;
}) {
  assertNixosSharedHostReleaseActionPhaseReplayAllowed(opts);
  for (const action of opts.releaseActions) {
    if (action.phase !== opts.phase || action.runCondition === "failure_only") continue;
    if (replayContextFor(opts.operationKind, opts.publishBehavior)) {
      const replayContext = replayContextFor(opts.operationKind, opts.publishBehavior)!;
      if (action.replayPolicy[replayContext] === "skip") continue;
    }
    await writeReleaseActionMarker({
      recordsRoot: opts.recordsRoot,
      deployRunId: opts.deployRunId,
      action,
      operationKind: opts.operationKind,
      deployment: opts.deployment,
      ...(opts.artifactIdentity ? { artifactIdentity: opts.artifactIdentity } : {}),
      ...(opts.publicUrl ? { publicUrl: opts.publicUrl } : {}),
    }).catch((error) => {
      if (action.abortBehavior === "continue") return;
      throw new Error(
        `release action ${action.ref} failed during ${action.phase}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
