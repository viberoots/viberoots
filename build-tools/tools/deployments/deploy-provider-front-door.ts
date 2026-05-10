#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli";
import { summarizeDeploymentResult } from "./deployment-execution";
import {
  resolveArtifactDirForCli,
  resolveComponentArtifactDirsForCli,
} from "./deployment-cli-resolve";
import { printDeployJson } from "./deploy-front-door";
import type { NixosSharedHostDeployment } from "./contract";
import { isMultiComponentNixosSharedHostDeployment } from "./nixos-shared-host-components";
import { maybeHandleNixosSharedHostBootstrapCli } from "./nixos-shared-host-bootstrap-cli";
import { submitNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane";
import { runProtectedNixosSharedHostDeployFrontDoor } from "./nixos-shared-host-protected-front-door";
import {
  runNixosSharedHostProvisionOnlyFrontDoor,
  runNixosSharedHostPublishOnlyFrontDoor,
} from "./nixos-shared-host-direct-source-front-door";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs";

export async function runNixosSharedHostDeployFrontDoor(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  publishOnly: boolean;
  provisionOnly: boolean;
  rollback: boolean;
  sourceRunId: string;
  artifactDirFlag: string;
  vaultRuntimeInputs?: DeploymentVaultRuntimeInputs;
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
  const protectedShared = opts.deployment.protectionClass !== "local_only";
  const controlPlaneDatabaseUrl =
    getFlagStr("control-plane-database-url", "").trim() ||
    String(process.env.VBR_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim() ||
    undefined;
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
  if (protectedShared) {
    printDeployJson(
      await runProtectedNixosSharedHostDeployFrontDoor({
        workspaceRoot: opts.workspaceRoot,
        deployment: opts.deployment,
        publishOnly: opts.publishOnly,
        provisionOnly: opts.provisionOnly,
        remove,
        rollback: opts.rollback,
        sourceRunId: opts.sourceRunId,
        artifactDirFlag: opts.artifactDirFlag,
        admissionEvidence: opts.admissionEvidence,
        smokeConnectOverride: opts.smokeConnectOverride,
        controlPlaneUrl:
          getFlagStr("control-plane-url", "").trim() ||
          String(process.env.VBR_DEPLOY_CONTROL_PLANE_URL || "").trim(),
        controlPlaneToken: getFlagStr("control-plane-token", "").trim() || undefined,
        remote: getFlagStr("remote", "").trim(),
        vaultRuntimeInputs: opts.vaultRuntimeInputs,
        hasFlag,
      }),
    );
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
      ? await runNixosSharedHostProvisionOnlyFrontDoor({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          paths,
          sourceRunId: opts.sourceRunId,
          artifactDirFlag: opts.artifactDirFlag,
          ...(controlPlaneDatabaseUrl ? { backendDatabaseUrl: controlPlaneDatabaseUrl } : {}),
          ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
          ...(opts.smokeConnectOverride
            ? { smokeConnectOverride: opts.smokeConnectOverride as any }
            : {}),
        })
      : opts.publishOnly
        ? await runNixosSharedHostPublishOnlyFrontDoor({
            workspaceRoot: opts.workspaceRoot,
            deployment: opts.deployment,
            paths,
            sourceRunId: opts.sourceRunId,
            artifactDirFlag: opts.artifactDirFlag,
            rollback: opts.rollback,
            ...(controlPlaneDatabaseUrl ? { backendDatabaseUrl: controlPlaneDatabaseUrl } : {}),
            ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
            ...(opts.smokeConnectOverride
              ? { smokeConnectOverride: opts.smokeConnectOverride as any }
              : {}),
          })
        : await runDeploy(opts, paths);
  printDeployJson(summarizeDeploymentResult(result));
}

async function runDeploy(
  opts: Parameters<typeof runNixosSharedHostDeployFrontDoor>[0],
  paths: {
    statePath: string;
    hostRoot: string;
    recordsRoot: string;
    hostConfigPath?: string;
  },
) {
  if (opts.sourceRunId) {
    throw new Error(
      "nixos-shared-host --source-run-id without --publish-only is not supported; rebuild-per-stage promotion is currently reviewed only for cloudflare-pages targets",
    );
  }
  if (isMultiComponentNixosSharedHostDeployment(opts.deployment)) {
    const artifactDirsByComponentId = await resolveComponentArtifactDirsForCli(
      opts.workspaceRoot,
      opts.deployment,
    );
    return await submitNixosSharedHostControlPlaneRun({
      workspaceRoot: opts.workspaceRoot,
      operationKind: "deploy",
      deployment: opts.deployment,
      artifactDirsByComponentId,
      paths,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
      ...(opts.smokeConnectOverride
        ? { smokeConnectOverride: opts.smokeConnectOverride as any }
        : {}),
    });
  }
  return await submitNixosSharedHostControlPlaneRun({
    workspaceRoot: opts.workspaceRoot,
    operationKind: "deploy",
    deployment: opts.deployment,
    artifactDir: await resolveArtifactDirForCli(opts.workspaceRoot, opts.deployment),
    paths,
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
  });
}
