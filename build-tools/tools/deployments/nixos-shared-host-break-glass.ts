#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import type { DeploymentControlPlaneAuthorization } from "./deployment-control-plane-contract.ts";
import { authorizeControlPlaneBreakGlass } from "./deployment-control-plane-authz.ts";
import {
  acquireBreakGlassFreeze,
  assertNoBreakGlassFreeze as assertNoBreakGlassFreezeActive,
} from "./nixos-shared-host-break-glass-freeze.ts";
import type {
  NixosSharedHostControlPlanePaths,
  NixosSharedHostMutationAuthority,
  NixosSharedHostPublishBehavior,
  NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import { runNixosSharedHostStaticDeploy } from "./nixos-shared-host-static-deploy.ts";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store.ts";

function evidencePath(recordsRoot: string, freezeId: string): string {
  return path.join(
    path.resolve(recordsRoot),
    "control-plane",
    "break-glass-evidence",
    `${freezeId}.json`,
  );
}

export async function assertNoBreakGlassFreeze(recordsRoot: string, lockScope: string) {
  await assertNoBreakGlassFreezeActive(recordsRoot, lockScope);
}

export async function runNixosSharedHostBreakGlassDeploy(opts: {
  deployment: NixosSharedHostDeployment;
  componentArtifacts: NixosSharedHostResolvedComponentArtifact[];
  compositeArtifactIdentity: string;
  paths: NixosSharedHostControlPlanePaths;
  authorization: DeploymentControlPlaneAuthorization;
  incidentRef: string;
  justification: string;
  bypassReason: string;
  executedBy: DeploymentPrincipal;
  approvedBy?: DeploymentPrincipal;
  publishBehavior?: NixosSharedHostPublishBehavior;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
}) {
  const incidentRef = opts.incidentRef.trim();
  const justification = opts.justification.trim();
  const bypassReason = opts.bypassReason.trim();
  if (!incidentRef || !justification || !bypassReason) {
    throw new Error(
      "break-glass requires incidentRef, justification, and bypassReason before mutation",
    );
  }
  authorizeControlPlaneBreakGlass({
    deployment: opts.deployment,
    incidentRef,
    authorization: opts.authorization,
  });
  const freezeId = `${Date.now()}-${opts.deployment.deploymentId}`;
  const freeze = await acquireBreakGlassFreeze(
    opts.paths.recordsRoot,
    opts.deployment.providerTarget.sharedDevTargetIdentity,
  );
  const evidence = {
    incidentRef,
    requestedBy: opts.authorization.requestedBy,
    ...(opts.approvedBy ? { approvedBy: opts.approvedBy } : {}),
    executedBy: opts.executedBy,
    justification,
    bypassReason,
    deploymentId: opts.deployment.deploymentId,
    providerTargetIdentity: opts.deployment.providerTarget.sharedDevTargetIdentity,
    selection: {
      kind: "exact_artifact",
      artifactIdentity: opts.compositeArtifactIdentity,
    },
    capturedAt: new Date().toISOString(),
  };
  const storedEvidencePath = evidencePath(opts.paths.recordsRoot, freezeId);
  await writeControlPlaneJson(storedEvidencePath, evidence);
  const authority: NixosSharedHostMutationAuthority = {
    kind: "break-glass-worker",
    incidentRef,
    freezeId,
    freezePath: freeze.freezePath,
    evidencePath: storedEvidencePath,
    requestedBy: opts.authorization.requestedBy,
    ...(opts.approvedBy ? { approvedBy: opts.approvedBy } : {}),
    executedBy: opts.executedBy,
    justification,
    bypassReason,
    selection: {
      kind: "exact_artifact",
      artifactIdentity: opts.compositeArtifactIdentity,
    },
  };
  try {
    return await runNixosSharedHostStaticDeploy({
      deployment: opts.deployment,
      operationKind: "deploy",
      publishBehavior: opts.publishBehavior || "publish-only",
      componentArtifacts: opts.componentArtifacts,
      compositeArtifactIdentity: opts.compositeArtifactIdentity,
      statePath: opts.paths.statePath,
      hostRoot: opts.paths.hostRoot,
      recordsRoot: opts.paths.recordsRoot,
      ...(opts.paths.hostConfigPath ? { hostConfigPath: opts.paths.hostConfigPath } : {}),
      ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      authority,
    });
  } finally {
    await freeze.release();
  }
}
