#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli.ts";
import { resolveDeploymentAdmissionEvidence } from "./deployment-admission-cli.ts";
import { resolveDeploymentForCli } from "./deployment-cli-resolve.ts";
import {
  listDeploymentsForCli,
  printDeployJson,
  validateDeploymentForCli,
} from "./deploy-front-door.ts";
import { runCloudflareDeployFrontDoor } from "./cloudflare-pages-front-door.ts";
import { runAppStoreConnectDeployFrontDoor } from "./app-store-connect-front-door.ts";
import { runGooglePlayDeployFrontDoor } from "./google-play-front-door.ts";
import { runKubernetesDeployFrontDoor } from "./kubernetes-front-door.ts";
import { resolveSmokeConnectOverride } from "./deployment-cli-smoke.ts";
import { runFromChangesCli } from "./deployment-from-changes-cli.ts";
import {
  isAppStoreConnectDeployment,
  isCloudflarePagesDeployment,
  isGooglePlayDeployment,
  isKubernetesDeployment,
  isNixosSharedHostDeployment,
  isS3StaticDeployment,
} from "./contract.ts";
import { maybeRunNixosSharedHostRemoteProfile } from "./nixos-shared-host-remote-cli.ts";
import { runNixosSharedHostDeployFrontDoor } from "./deploy-provider-front-door.ts";
import { runS3StaticDeployFrontDoor } from "./s3-static-front-door.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

function ensurePublicSourceOfTruth(opts: { deploymentJsonErrorMessage: string }) {
  if (hasFlag("deployment-json")) {
    throw new Error(opts.deploymentJsonErrorMessage);
  }
}

export async function runDeployCli(opts: {
  workspaceRoot: string;
  publicFrontDoor: boolean;
  deploymentJsonErrorMessage: string;
}) {
  ensurePublicSourceOfTruth(opts);
  if (getFlagBool("from-changes")) {
    await runFromChangesCli(opts.workspaceRoot);
    return;
  }
  if (getFlagBool("list")) {
    if (
      [
        "validate-only",
        "provision-only",
        "publish-only",
        "preview",
        "preview-cleanup",
        "remove",
        "rollback",
      ].some((flag) => getFlagBool(flag))
    ) {
      throw new Error("--list cannot be combined with deploy mutation or validation flags");
    }
    printDeployJson(await listDeploymentsForCli(opts.workspaceRoot));
    return;
  }
  const deployment = await resolveDeploymentForCli(opts.workspaceRoot, requireFlag, {
    deploymentJsonErrorMessage: opts.deploymentJsonErrorMessage,
  });
  const remove = getFlagBool("remove");
  const validateOnly = getFlagBool("validate-only");
  const provisionOnly = getFlagBool("provision-only");
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
  if (
    validateOnly &&
    (provisionOnly || publishOnly || preview || previewCleanup || remove || rollback)
  ) {
    throw new Error(
      "--validate-only cannot be combined with mutating, preview, or publish-only flags",
    );
  }
  if (provisionOnly && (publishOnly || preview || previewCleanup || remove || rollback)) {
    throw new Error(
      "--provision-only cannot be combined with --publish-only, preview, remove, or rollback",
    );
  }
  if (validateOnly) {
    printDeployJson(await validateDeploymentForCli(opts.workspaceRoot, deployment));
    return;
  }
  if (preview && previewCleanup) {
    throw new Error("--preview and --preview-cleanup are mutually exclusive");
  }
  if (retireTarget && migrateTarget) {
    throw new Error("--retire-target and --migrate-target are mutually exclusive");
  }
  if (preview && (publishOnly || remove || rollback)) {
    throw new Error("--preview cannot be combined with --publish-only, --remove, or --rollback");
  }
  if (previewCleanup && (publishOnly || remove || rollback)) {
    throw new Error(
      "--preview-cleanup cannot be combined with --publish-only, --remove, or --rollback",
    );
  }
  if ((retireTarget || migrateTarget) && (publishOnly || remove || preview || previewCleanup)) {
    throw new Error(
      "--retire-target/--migrate-target cannot be combined with deploy, publish-only, remove, or preview flags",
    );
  }
  if (isS3StaticDeployment(deployment)) {
    await runS3StaticDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      requireServiceForProtectedShared: opts.publicFrontDoor,
      publishOnly,
      provisionOnly,
      rollback,
      sourceRunId,
      artifactDirFlag,
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
      hasFlag,
    });
    return;
  }
  if (isCloudflarePagesDeployment(deployment)) {
    await runCloudflareDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      requireServiceForProtectedShared: opts.publicFrontDoor,
      publishOnly,
      preview,
      previewCleanup,
      rollback,
      retireTarget,
      migrateTarget,
      targetExceptionRef,
      sourceRunId,
      artifactDirFlag,
      cleanupReason,
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
      provisionOnly,
    });
    return;
  }
  if (isAppStoreConnectDeployment(deployment)) {
    await runAppStoreConnectDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      publishOnly,
      rollback,
      sourceRunId,
      artifactDirFlag,
      ...(admissionEvidence ? { admissionEvidence } : {}),
    });
    return;
  }
  if (isGooglePlayDeployment(deployment)) {
    await runGooglePlayDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      publishOnly,
      rollback,
      sourceRunId,
      artifactDirFlag,
      ...(admissionEvidence ? { admissionEvidence } : {}),
    });
    return;
  }
  if (isKubernetesDeployment(deployment)) {
    await runKubernetesDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      requireServiceForProtectedShared: opts.publicFrontDoor,
      publishOnly,
      provisionOnly,
      rollback,
      sourceRunId,
      artifactDirFlag,
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
      hasFlag,
    });
    return;
  }
  if (!isNixosSharedHostDeployment(deployment)) {
    throw new Error(`unsupported deployment provider: ${deployment.provider}`);
  }
  if (
    await maybeRunNixosSharedHostRemoteProfile({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      ...(admissionEvidence ? { admissionEvidence } : {}),
    })
  ) {
    return;
  }
  await runNixosSharedHostDeployFrontDoor({
    workspaceRoot: opts.workspaceRoot,
    deployment,
    publishOnly,
    provisionOnly,
    rollback,
    sourceRunId,
    artifactDirFlag,
    ...(admissionEvidence ? { admissionEvidence } : {}),
    ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
  });
}
