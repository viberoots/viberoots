#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import {
  resolveArtifactDirForCli,
  resolveComponentArtifactDirsForCli,
} from "./deployment-cli-resolve.ts";
import { printDeployJson } from "./deploy-front-door.ts";
import type { CloudflarePagesDeployment, NixosSharedHostDeployment } from "./contract.ts";
import { isMultiComponentNixosSharedHostDeployment } from "./nixos-shared-host-components.ts";
import { submitCloudflarePagesTargetTransition } from "./cloudflare-pages-target-transition.ts";
import { runCloudflarePagesCli } from "./cloudflare-pages-cli.ts";
import { maybeHandleNixosSharedHostBootstrapCli } from "./nixos-shared-host-bootstrap-cli.ts";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane.ts";
import { submitNixosSharedHostPublishOnlyRun } from "./nixos-shared-host-publish-only.ts";
import { submitNixosSharedHostProvisionOnlyRun } from "./nixos-shared-host-provision-only.ts";

export async function runCloudflareDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  publishOnly: boolean;
  preview: boolean;
  previewCleanup: boolean;
  rollback: boolean;
  retireTarget: boolean;
  migrateTarget: boolean;
  targetExceptionRef: string;
  sourceRunId: string;
  artifactDirFlag: string;
  cleanupReason: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  provisionOnly: boolean;
}) {
  if (getFlagBool("bootstrap") || getFlagStr("bootstrap-reconcile-run-id", "").trim()) {
    throw new Error("bootstrap is currently supported only for nixos-shared-host deployments");
  }
  if (opts.provisionOnly) {
    throw new Error(
      "cloudflare-pages does not support --provision-only on the repo-level deploy front door",
    );
  }
  if (getFlagBool("remove"))
    throw new Error("cloudflare-pages deploys do not support --remove yet");
  if (opts.rollback && !opts.publishOnly)
    throw new Error("cloudflare-pages rollback requires --publish-only");
  const recordsRoot = path.resolve(
    getFlagStr(
      "records-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "cloudflare-pages", "records"),
    ),
  );
  if (opts.retireTarget || opts.migrateTarget) {
    if (!opts.targetExceptionRef)
      throw new Error("--retire-target/--migrate-target requires --target-exception-ref");
    const result = await submitCloudflarePagesTargetTransition({
      deployment: opts.deployment,
      recordsRoot,
      operationKind: opts.retireTarget ? "retire_target" : "migrate_target",
      targetExceptionRef: opts.targetExceptionRef,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    });
    printDeployJson({
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
    opts.publishOnly || opts.preview || opts.previewCleanup
      ? undefined
      : await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment);
  const result = await runCloudflarePagesCli({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    artifactDirFlag: opts.artifactDirFlag,
    resolvedArtifactDir,
    recordsRoot,
    publishOnly: opts.publishOnly,
    rollback: opts.rollback,
    preview: opts.preview,
    previewCleanup: opts.previewCleanup,
    sourceRunId: opts.sourceRunId,
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
    cleanupReason: opts.cleanupReason,
    provisionOnly: opts.provisionOnly,
  });
  printDeployJson(summarizeDeploymentResult(result));
}

export async function runNixosSharedHostDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  publishOnly: boolean;
  provisionOnly: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
}) {
  const remove = getFlagBool("remove");
  if (getFlagBool("preview") || getFlagBool("preview-cleanup")) {
    throw new Error("nixos-shared-host deploys do not support --preview or --preview-cleanup");
  }
  if (
    getFlagBool("bootstrap") &&
    (opts.publishOnly || remove || opts.rollback || opts.sourceRunId)
  ) {
    throw new Error(
      "--bootstrap cannot be combined with --publish-only, --remove, --rollback, or --source-run-id",
    );
  }
  if (
    getFlagStr("bootstrap-reconcile-run-id", "").trim() &&
    (opts.publishOnly || remove || opts.rollback || opts.sourceRunId || getFlagBool("bootstrap"))
  ) {
    throw new Error("--bootstrap-reconcile-run-id cannot be combined with mutating deploy flags");
  }
  if (opts.rollback && !opts.publishOnly) throw new Error("--rollback requires --publish-only");
  if (remove && (opts.publishOnly || opts.rollback || opts.sourceRunId)) {
    throw new Error(
      "--remove cannot be combined with --publish-only, --rollback, or --source-run-id",
    );
  }
  const hostRoot = path.resolve(
    getFlagStr(
      "host-root",
      path.join(opts.workspaceRoot, ".local", "deployments", "nixos-shared-host"),
    ),
  );
  const hostConfigPath = getFlagStr("host-config-out", "").trim();
  const paths = {
    statePath: path.resolve(getFlagStr("state", path.join(hostRoot, "platform-state.json"))),
    hostRoot,
    recordsRoot: path.resolve(getFlagStr("records-root", path.join(hostRoot, "records"))),
    ...(hostConfigPath ? { hostConfigPath: path.resolve(hostConfigPath) } : {}),
  };
  const bootstrapResult = await maybeHandleNixosSharedHostBootstrapCli({
    deployment: opts.deployment,
    recordsRoot: paths.recordsRoot,
    paths,
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
  });
  if (bootstrapResult) {
    printDeployJson(bootstrapResult.value);
    return;
  }
  const result = remove
    ? await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: opts.workspaceRoot,
        operationKind: "explicit_removal",
        deployment: opts.deployment,
        paths,
        ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
      })
    : opts.provisionOnly
      ? await (() => {
          if (opts.artifactDirFlag)
            throw new Error(
              "nixos-shared-host --provision-only must not use --artifact-dir; default metadata-only runs do not load artifacts, and immutable reuse must be selected with --source-run-id",
            );
          return submitNixosSharedHostProvisionOnlyRun({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.deployment,
            paths,
            sourceRunId: opts.sourceRunId,
            ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
            ...(opts.smokeConnectOverride
              ? { smokeConnectOverride: opts.smokeConnectOverride as any }
              : {}),
          });
        })()
      : opts.publishOnly
        ? await (() => {
            if (!opts.sourceRunId)
              throw new Error(
                opts.rollback
                  ? "shared rollback requires --source-run-id"
                  : "shared --publish-only requires --source-run-id to select an admitted run",
              );
            if (opts.artifactDirFlag)
              throw new Error(
                "shared --publish-only must not use --artifact-dir; replay the admitted exact artifact with --source-run-id",
              );
            return submitNixosSharedHostPublishOnlyRun({
              workspaceRoot: opts.workspaceRoot,
              deployment: opts.deployment,
              paths,
              sourceRunId: opts.sourceRunId,
              rollback: opts.rollback,
              ...(opts.admissionEvidence
                ? { admissionEvidence: opts.admissionEvidence as any }
                : {}),
              ...(opts.smokeConnectOverride
                ? { smokeConnectOverride: opts.smokeConnectOverride as any }
                : {}),
            });
          })()
        : await (() => {
            if (opts.sourceRunId)
              throw new Error(
                "nixos-shared-host --source-run-id without --publish-only is not supported; rebuild-per-stage promotion is currently reviewed only for cloudflare-pages targets",
              );
            return isMultiComponentNixosSharedHostDeployment(opts.deployment)
              ? resolveComponentArtifactDirsForCli(opts.workspaceRoot, opts.deployment).then(
                  (artifactDirsByComponentId) =>
                    submitNixosSharedHostControlPlaneRun({
                      workspaceRoot: opts.workspaceRoot,
                      operationKind: "deploy",
                      deployment: opts.deployment,
                      artifactDirsByComponentId,
                      paths,
                      ...(opts.admissionEvidence
                        ? { admissionEvidence: opts.admissionEvidence as any }
                        : {}),
                      ...(opts.smokeConnectOverride
                        ? { smokeConnectOverride: opts.smokeConnectOverride as any }
                        : {}),
                    }),
                )
              : resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment).then((artifactDir) =>
                  submitNixosSharedHostControlPlaneRun({
                    workspaceRoot: opts.workspaceRoot,
                    operationKind: "deploy",
                    deployment: opts.deployment,
                    artifactDir,
                    paths,
                    ...(opts.admissionEvidence
                      ? { admissionEvidence: opts.admissionEvidence as any }
                      : {}),
                    ...(opts.smokeConnectOverride
                      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
                      : {}),
                  }),
                );
          })();
  printDeployJson(summarizeDeploymentResult(result));
}
