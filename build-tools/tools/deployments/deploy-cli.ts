#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli.ts";
import { resolveDeploymentAdmissionEvidence } from "./deployment-admission-cli.ts";
import { resolveDeploymentForCli } from "./deployment-cli-resolve.ts";
import {
  assertDeployCliReadonlyGuardrails,
  maybeHandleReadonlyDeployCli,
  readDeployCliReadonlyFlags,
} from "./deploy-cli-readonly.ts";
import { listDeploymentsForCli, printDeployJson } from "./deploy-front-door.ts";
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
        "print-target-identity",
        "print-vault-bootstrap",
        "print-vault-secret-templates",
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
  const flags = readDeployCliReadonlyFlags();
  const admissionEvidence = await resolveDeploymentAdmissionEvidence();
  const smokeConnectOverride = resolveSmokeConnectOverride();
  assertDeployCliReadonlyGuardrails(flags);
  if (
    await maybeHandleReadonlyDeployCli({ workspaceRoot: opts.workspaceRoot, deployment, flags })
  ) {
    return;
  }
  if (flags.preview && flags.previewCleanup) {
    throw new Error("--preview and --preview-cleanup are mutually exclusive");
  }
  if (flags.retireTarget && flags.migrateTarget) {
    throw new Error("--retire-target and --migrate-target are mutually exclusive");
  }
  if (flags.preview && (flags.publishOnly || flags.remove || flags.rollback)) {
    throw new Error("--preview cannot be combined with --publish-only, --remove, or --rollback");
  }
  if (flags.previewCleanup && (flags.publishOnly || flags.remove || flags.rollback)) {
    throw new Error(
      "--preview-cleanup cannot be combined with --publish-only, --remove, or --rollback",
    );
  }
  if (
    (flags.retireTarget || flags.migrateTarget) &&
    (flags.publishOnly || flags.remove || flags.preview || flags.previewCleanup)
  ) {
    throw new Error(
      "--retire-target/--migrate-target cannot be combined with deploy, publish-only, remove, or preview flags",
    );
  }
  if (isS3StaticDeployment(deployment)) {
    await runS3StaticDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      requireServiceForProtectedShared: opts.publicFrontDoor,
      publishOnly: flags.publishOnly,
      provisionOnly: flags.provisionOnly,
      rollback: flags.rollback,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
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
      publishOnly: flags.publishOnly,
      preview: flags.preview,
      previewCleanup: flags.previewCleanup,
      rollback: flags.rollback,
      retireTarget: flags.retireTarget,
      migrateTarget: flags.migrateTarget,
      targetExceptionRef: flags.targetExceptionRef,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
      cleanupReason: flags.cleanupReason,
      ...(admissionEvidence ? { admissionEvidence } : {}),
      ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
      provisionOnly: flags.provisionOnly,
    });
    return;
  }
  if (isAppStoreConnectDeployment(deployment)) {
    await runAppStoreConnectDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      publishOnly: flags.publishOnly,
      rollback: flags.rollback,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
      ...(admissionEvidence ? { admissionEvidence } : {}),
    });
    return;
  }
  if (isGooglePlayDeployment(deployment)) {
    await runGooglePlayDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      publishOnly: flags.publishOnly,
      rollback: flags.rollback,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
      ...(admissionEvidence ? { admissionEvidence } : {}),
    });
    return;
  }
  if (isKubernetesDeployment(deployment)) {
    await runKubernetesDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      requireServiceForProtectedShared: opts.publicFrontDoor,
      publishOnly: flags.publishOnly,
      provisionOnly: flags.provisionOnly,
      rollback: flags.rollback,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
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
    publishOnly: flags.publishOnly,
    provisionOnly: flags.provisionOnly,
    rollback: flags.rollback,
    sourceRunId: flags.sourceRunId,
    artifactDirFlag: flags.artifactDirFlag,
    ...(admissionEvidence ? { admissionEvidence } : {}),
    ...(smokeConnectOverride ? { smokeConnectOverride } : {}),
  });
}
