#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import { resolveDeploymentAdmissionEvidence } from "./deployment-admission-cli.ts";
import {
  resolveArtifactDirForCli,
  resolveComponentArtifactDirsForCli,
  resolveDeploymentForCli,
} from "./deployment-cli-resolve.ts";
import { resolveSmokeConnectOverride } from "./deployment-cli-smoke.ts";
import { runFromChangesCli } from "./deployment-from-changes-cli.ts";
import { runCloudflarePagesCli } from "./cloudflare-pages-cli.ts";
import { isNixosSharedHostDeployment, type DeploymentTarget } from "./contract.ts";
import { submitCloudflarePagesTargetTransition } from "./cloudflare-pages-target-transition.ts";
import { isMultiComponentNixosSharedHostDeployment } from "./nixos-shared-host-components.ts";
import { maybeHandleNixosSharedHostBootstrapCli } from "./nixos-shared-host-bootstrap-cli.ts";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane.ts";
import { submitNixosSharedHostPublishOnlyRun } from "./nixos-shared-host-publish-only.ts";
import { maybeRunNixosSharedHostRemoteProfile } from "./nixos-shared-host-remote-cli.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const workspaceRoot = await findRepoRoot(process.cwd());
  if (getFlagBool("from-changes")) {
    await runFromChangesCli(workspaceRoot);
    return;
  }
  const deployment = await resolveDeploymentForCli(workspaceRoot, requireFlag);
  const remove = getFlagBool("remove");
  const publishOnly = getFlagBool("publish-only");
  const preview = getFlagBool("preview");
  const previewCleanup = getFlagBool("preview-cleanup");
  const rollback = getFlagBool("rollback");
  const retireTarget = getFlagBool("retire-target");
  const migrateTarget = getFlagBool("migrate-target");
  const targetExceptionRef = getFlagStr("target-exception-ref", "").trim();
  const cleanupReason = getFlagStr("cleanup-reason", "manual_cleanup").trim();
  const sourceRunId = getFlagStr("source-run-id", "").trim();
  const artifactDirFlag = getFlagStr("artifact-dir", "").trim();
  const admissionEvidence = await resolveDeploymentAdmissionEvidence();
  const smokeConnectOverride = resolveSmokeConnectOverride();
  if (preview && previewCleanup) {
    throw new Error("--preview and --preview-cleanup are mutually exclusive");
  }
  if (retireTarget && migrateTarget) {
    throw new Error("--retire-target and --migrate-target are mutually exclusive");
  }
  if (preview && (publishOnly || remove || rollback)) {
    throw new Error("--preview cannot be combined with --publish-only, --remove, or --rollback");
  }
  if (previewCleanup && (publishOnly || remove || rollback))
    throw new Error(
      "--preview-cleanup cannot be combined with --publish-only, --remove, or --rollback",
    );
  if ((retireTarget || migrateTarget) && (publishOnly || remove || preview || previewCleanup))
    throw new Error(
      "--retire-target/--migrate-target cannot be combined with deploy, publish-only, remove, or preview flags",
    );
  if (!isNixosSharedHostDeployment(deployment)) {
    if (getFlagBool("bootstrap") || getFlagStr("bootstrap-reconcile-run-id", "").trim()) {
      throw new Error("bootstrap is currently supported only for nixos-shared-host deployments");
    }
    if (remove) throw new Error("cloudflare-pages deploys do not support --remove yet");
    if (rollback && !publishOnly)
      throw new Error("cloudflare-pages rollback requires --publish-only");
    const recordsRoot = path.resolve(
      getFlagStr(
        "records-root",
        path.join(workspaceRoot, ".local", "deployments", "cloudflare-pages", "records"),
      ),
    );
    if (retireTarget || migrateTarget) {
      if (!targetExceptionRef)
        throw new Error("--retire-target/--migrate-target requires --target-exception-ref");
      const result = await submitCloudflarePagesTargetTransition({
        deployment,
        recordsRoot,
        operationKind: retireTarget ? "retire_target" : "migrate_target",
        targetExceptionRef,
        ...(admissionEvidence ? { admissionEvidence } : {}),
      });
      printJson({
        runId: result.record.deployRunId,
        deployRunId: result.record.deployRunId,
        operationKind: result.record.operationKind,
        runClassification: result.record.runClassification,
        finalOutcome: result.record.finalOutcome,
        recordPath: result.recordPath,
        controlPlane: result.record.controlPlane,
      });
      return;
    }
    const resolvedArtifactDir =
      publishOnly || preview || previewCleanup
        ? undefined
        : await resolveArtifactDirForCli(workspaceRoot, deployment);
    const result = await runCloudflarePagesCli({
      workspaceRoot,
      deployment,
      artifactDirFlag,
      resolvedArtifactDir,
      recordsRoot,
      publishOnly,
      rollback,
      preview,
      previewCleanup,
      sourceRunId,
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
      cleanupReason,
    });
    printJson(summarizeDeploymentResult(result));
    return;
  }
  if (preview || previewCleanup)
    throw new Error("nixos-shared-host deploys do not support --preview or --preview-cleanup");
  if (await maybeRunNixosSharedHostRemoteProfile({ workspaceRoot, deployment })) return;
  if (getFlagBool("bootstrap") && (publishOnly || remove || rollback || sourceRunId)) {
    throw new Error(
      "--bootstrap cannot be combined with --publish-only, --remove, --rollback, or --source-run-id",
    );
  }
  if (
    getFlagStr("bootstrap-reconcile-run-id", "").trim() &&
    (publishOnly || remove || rollback || sourceRunId || getFlagBool("bootstrap"))
  ) {
    throw new Error("--bootstrap-reconcile-run-id cannot be combined with mutating deploy flags");
  }
  if (rollback && !publishOnly) throw new Error("--rollback requires --publish-only");
  if (remove && (publishOnly || rollback || sourceRunId))
    throw new Error(
      "--remove cannot be combined with --publish-only, --rollback, or --source-run-id",
    );
  const hostRoot = path.resolve(
    getFlagStr("host-root", path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host")),
  );
  const statePath = path.resolve(getFlagStr("state", path.join(hostRoot, "platform-state.json")));
  const recordsRoot = path.resolve(getFlagStr("records-root", path.join(hostRoot, "records")));
  const hostConfigPath = getFlagStr("host-config-out", "").trim();
  const paths = {
    statePath,
    hostRoot,
    recordsRoot,
    ...(hostConfigPath ? { hostConfigPath: path.resolve(hostConfigPath) } : {}),
  };
  const bootstrapResult = await maybeHandleNixosSharedHostBootstrapCli({
    deployment,
    recordsRoot,
    paths,
    ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
  });
  if (bootstrapResult) {
    printJson(bootstrapResult.value);
    return;
  }
  const result = remove
    ? await submitNixosSharedHostControlPlaneRun({
        workspaceRoot,
        operationKind: "explicit_removal",
        deployment,
        paths,
        ...(admissionEvidence ? { admissionEvidence } : {}),
      })
    : await (async () => {
        if (publishOnly) {
          if (!sourceRunId)
            throw new Error(
              rollback
                ? "shared rollback requires --source-run-id"
                : "shared --publish-only requires --source-run-id to select an admitted run",
            );
          if (artifactDirFlag)
            throw new Error(
              "shared --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
            );
          return await submitNixosSharedHostPublishOnlyRun({
            workspaceRoot,
            deployment,
            paths,
            sourceRunId,
            rollback,
            ...(admissionEvidence ? { admissionEvidence } : {}),
            ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
          });
        }
        if (sourceRunId)
          throw new Error(
            "nixos-shared-host --source-run-id without --publish-only is not supported; rebuild-per-stage promotion is currently reviewed only for cloudflare-pages targets",
          );
        const componentArtifactDirs = isMultiComponentNixosSharedHostDeployment(deployment)
          ? await resolveComponentArtifactDirsForCli(workspaceRoot, deployment)
          : undefined;
        const artifactDir = componentArtifactDirs
          ? undefined
          : await resolveArtifactDirForCli(workspaceRoot, deployment);
        return await submitNixosSharedHostControlPlaneRun({
          workspaceRoot,
          operationKind: "deploy",
          deployment,
          ...(artifactDir ? { artifactDir } : {}),
          ...(componentArtifactDirs ? { artifactDirsByComponentId: componentArtifactDirs } : {}),
          paths,
          ...(admissionEvidence ? { admissionEvidence } : {}),
          ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
        });
      })();
  printJson(summarizeDeploymentResult(result));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
