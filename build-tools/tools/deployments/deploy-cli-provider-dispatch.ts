#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import {
  isAppStoreConnectDeployment,
  isCloudflareContainersDeployment,
  isCloudflarePagesDeployment,
  isGooglePlayDeployment,
  isKubernetesDeployment,
  isNixosSharedHostDeployment,
  isOpenTofuDeployment,
  isS3StaticDeployment,
} from "./contract";
import type { DeployCliReadonlyFlags } from "./deploy-cli-readonly";

export async function runProviderDeployFrontDoor(opts: {
  workspaceRoot: string;
  publicFrontDoor: boolean;
  deployment: DeploymentTarget;
  flags: DeployCliReadonlyFlags;
  admissionEvidence?: unknown;
  smokeConnectOverride?: unknown;
  hasFlag: (name: string) => boolean;
}) {
  const { deployment, flags } = opts;
  if (isS3StaticDeployment(deployment)) {
    const { runS3StaticDeployFrontDoor } = await import("./s3-static-front-door");
    await runS3StaticDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      requireServiceForProtectedShared: opts.publicFrontDoor,
      publishOnly: flags.publishOnly,
      provisionOnly: flags.provisionOnly,
      rollback: flags.rollback,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
      backendDatabaseUrl: flags.controlPlaneDatabaseUrl,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
      ...(opts.smokeConnectOverride
        ? { smokeConnectOverride: opts.smokeConnectOverride as any }
        : {}),
      hasFlag: opts.hasFlag,
    });
    return;
  }
  if (isCloudflarePagesDeployment(deployment)) {
    const { runCloudflareDeployFrontDoor } = await import("./cloudflare-pages-front-door");
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
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
      ...(opts.smokeConnectOverride
        ? { smokeConnectOverride: opts.smokeConnectOverride as any }
        : {}),
      provisionOnly: flags.provisionOnly,
    });
    return;
  }
  if (isCloudflareContainersDeployment(deployment)) {
    const { runCloudflareContainersDeployFrontDoor } = await import(
      "./cloudflare-containers-front-door"
    );
    await runCloudflareContainersDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      requireServiceForProtectedShared: opts.publicFrontDoor,
      artifactDirFlag: flags.artifactDirFlag,
    });
    return;
  }
  if (isAppStoreConnectDeployment(deployment)) {
    const { runAppStoreConnectDeployFrontDoor } = await import("./app-store-connect-front-door");
    await runAppStoreConnectDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      publishOnly: flags.publishOnly,
      rollback: flags.rollback,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    });
    return;
  }
  if (isGooglePlayDeployment(deployment)) {
    const { runGooglePlayDeployFrontDoor } = await import("./google-play-front-door");
    await runGooglePlayDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      publishOnly: flags.publishOnly,
      rollback: flags.rollback,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    });
    return;
  }
  if (isKubernetesDeployment(deployment)) {
    const { runKubernetesDeployFrontDoor } = await import("./kubernetes-front-door");
    await runKubernetesDeployFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      requireServiceForProtectedShared: opts.publicFrontDoor,
      publishOnly: flags.publishOnly,
      provisionOnly: flags.provisionOnly,
      rollback: flags.rollback,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
      backendDatabaseUrl: flags.controlPlaneDatabaseUrl,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
      ...(opts.smokeConnectOverride
        ? { smokeConnectOverride: opts.smokeConnectOverride as any }
        : {}),
      hasFlag: opts.hasFlag,
    });
    return;
  }
  if (deployment.provider === "vercel") {
    await (
      await import("./vercel-front-door")
    ).runVercelDeployFrontDoorForCli(
      opts.workspaceRoot,
      deployment as any,
      flags,
      opts.publicFrontDoor,
      opts.hasFlag,
      opts.admissionEvidence,
      opts.smokeConnectOverride,
    );
    return;
  }
  if (isOpenTofuDeployment(deployment)) {
    const { runOpenTofuFoundationFrontDoor } = await import("./opentofu-foundation-front-door");
    await runOpenTofuFoundationFrontDoor({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      provisionOnly: flags.provisionOnly,
      sourceRunId: flags.sourceRunId,
      artifactDirFlag: flags.artifactDirFlag,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    });
    return;
  }
  if (!isNixosSharedHostDeployment(deployment)) {
    throw new Error(`unsupported deployment provider: ${deployment.provider}`);
  }
  const { maybeRunNixosSharedHostRemoteProfile } = await import(
    "./nixos-shared-host-remote-cli.ts"
  );
  if (
    await maybeRunNixosSharedHostRemoteProfile({
      workspaceRoot: opts.workspaceRoot,
      deployment,
      defaultProfileName: opts.publicFrontDoor ? deployment.lanePolicy.defaultClientProfile : "",
      vaultRuntimeInputs: flags.vaultRuntimeInputs,
      ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    })
  ) {
    return;
  }
  const { runNixosSharedHostDeployFrontDoor } = await import("./deploy-provider-front-door");
  await runNixosSharedHostDeployFrontDoor({
    workspaceRoot: opts.workspaceRoot,
    deployment,
    publishOnly: flags.publishOnly,
    provisionOnly: flags.provisionOnly,
    rollback: flags.rollback,
    sourceRunId: flags.sourceRunId,
    artifactDirFlag: flags.artifactDirFlag,
    vaultRuntimeInputs: flags.vaultRuntimeInputs,
    ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence as any } : {}),
    ...(opts.smokeConnectOverride
      ? { smokeConnectOverride: opts.smokeConnectOverride as any }
      : {}),
  });
}
