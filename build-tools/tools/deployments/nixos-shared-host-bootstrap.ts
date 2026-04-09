#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { authorizeControlPlaneBootstrap } from "./deployment-control-plane-authz.ts";
import type { DeploymentControlPlaneAuthorization } from "./deployment-control-plane-contract.ts";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import {
  type NixosSharedHostBootstrapAuthority,
  type NixosSharedHostBootstrapMode,
  type NixosSharedHostControlPlanePaths,
  type NixosSharedHostPublishBehavior,
  type NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import {
  deployRecordPathFor,
  type NixosSharedHostDeployRecord,
  createNixosSharedHostDeployRunId,
  readNixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";
import { runNixosSharedHostStaticDeploy } from "./nixos-shared-host-static-deploy.ts";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store.ts";
import { providerTargetIdentityFor, type NixosSharedHostDeployment } from "./contract.ts";

const BOOTSTRAP_SNAPSHOT_SCHEMA = "nixos-shared-host-bootstrap-snapshot@1";
const BOOTSTRAP_RECONCILIATION_SCHEMA = "nixos-shared-host-bootstrap-reconciliation@1";

function bootstrapEvidencePath(recordsRoot: string, deployRunId: string): string {
  return path.join(
    path.resolve(recordsRoot),
    "control-plane",
    "bootstrap-evidence",
    `${deployRunId}.json`,
  );
}

function bootstrapSnapshotPath(recordsRoot: string, deployRunId: string): string {
  return path.join(
    path.resolve(recordsRoot),
    "control-plane",
    "bootstrap-snapshots",
    `${deployRunId}.json`,
  );
}

function bootstrapReconciliationPath(recordsRoot: string, deployRunId: string): string {
  return path.join(
    path.resolve(recordsRoot),
    "control-plane",
    "bootstrap-reconciliations",
    `${deployRunId}.json`,
  );
}

function requireBootstrapDeployment(deployment: NixosSharedHostDeployment) {
  if (!deployment.bootstrap) {
    throw new Error(
      `bootstrap is not allowed for ${deployment.deploymentId}; target is not deployment-system-owned infrastructure`,
    );
  }
  if (deployment.releaseActions.length > 0) {
    throw new Error("bootstrap deployments must not declare release_actions");
  }
  return deployment.bootstrap;
}

function requireModeAllowed(
  deployment: NixosSharedHostDeployment,
  mode: NixosSharedHostBootstrapMode,
) {
  const bootstrap = requireBootstrapDeployment(deployment);
  if (!bootstrap.modes.includes(mode)) {
    throw new Error(`bootstrap mode ${mode} is not enabled for ${deployment.deploymentId}`);
  }
}

async function hasIngestedBootstrapRecord(recordsRoot: string, deploymentId: string) {
  const runsDir = path.join(path.resolve(recordsRoot), "runs");
  try {
    const entries = await fsp.readdir(runsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const record = JSON.parse(
        await fsp.readFile(path.join(runsDir, entry), "utf8"),
      ) as NixosSharedHostDeployRecord;
      if (
        record.deploymentId === deploymentId &&
        record.bootstrap?.reconciliation.status === "ingested"
      ) {
        return true;
      }
    }
  } catch {}
  return false;
}

export async function runNixosSharedHostBootstrapDeploy(opts: {
  deployment: NixosSharedHostDeployment;
  componentArtifacts: NixosSharedHostResolvedComponentArtifact[];
  compositeArtifactIdentity: string;
  paths: NixosSharedHostControlPlanePaths;
  authorization: DeploymentControlPlaneAuthorization;
  mode: NixosSharedHostBootstrapMode;
  ownershipProof: string;
  targetIdentityProof: string;
  executedBy: DeploymentPrincipal;
  publishBehavior?: NixosSharedHostPublishBehavior;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
}) {
  requireModeAllowed(opts.deployment, opts.mode);
  if (
    opts.mode === "first_install" &&
    (await hasIngestedBootstrapRecord(opts.paths.recordsRoot, opts.deployment.deploymentId))
  ) {
    throw new Error(
      `bootstrap for ${opts.deployment.deploymentId} has already been reconciled; use the normal control plane for routine updates`,
    );
  }
  const ownershipProof = opts.ownershipProof.trim();
  if (!ownershipProof) throw new Error("bootstrap requires explicit ownership proof");
  const targetIdentityProof = opts.targetIdentityProof.trim();
  const targetIdentity = providerTargetIdentityFor(opts.deployment);
  if (!targetIdentityProof || targetIdentityProof !== targetIdentity) {
    throw new Error(`bootstrap target identity proof mismatch for ${opts.deployment.deploymentId}`);
  }
  const artifactIdentity = opts.compositeArtifactIdentity.trim();
  if (!artifactIdentity || opts.componentArtifacts.length === 0) {
    throw new Error("bootstrap requires exact immutable admitted component artifacts");
  }
  const authorization = authorizeControlPlaneBootstrap({
    deployment: opts.deployment,
    authorization: opts.authorization,
  });
  const deployRunId = createNixosSharedHostDeployRunId("bootstrap");
  const evidencePath = bootstrapEvidencePath(opts.paths.recordsRoot, deployRunId);
  const executionSnapshotPath = bootstrapSnapshotPath(opts.paths.recordsRoot, deployRunId);
  const authority: NixosSharedHostBootstrapAuthority = {
    kind: "bootstrap-worker",
    mode: opts.mode,
    evidencePath,
    executionSnapshotPath,
    lockScope: targetIdentity,
    requestedBy: authorization.principal,
    executedBy: opts.executedBy,
    ownershipProof,
    targetIdentityProof,
    selection: { kind: "exact_artifact", artifactIdentity },
  };
  await writeControlPlaneJson(evidencePath, {
    deploymentId: opts.deployment.deploymentId,
    mode: opts.mode,
    requestedBy: authorization.principal,
    executedBy: opts.executedBy,
    ownershipProof,
    targetIdentityProof,
    selection: authority.selection,
    capturedAt: new Date().toISOString(),
  });
  await writeControlPlaneJson(executionSnapshotPath, {
    schemaVersion: BOOTSTRAP_SNAPSHOT_SCHEMA,
    deployRunId,
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    mode: opts.mode,
    targetIdentity,
    evidencePath,
    selection: authority.selection,
  });
  return await runNixosSharedHostStaticDeploy({
    deployment: opts.deployment,
    deployRunId,
    operationKind: "deploy",
    publishBehavior: opts.publishBehavior || "deploy",
    componentArtifacts: opts.componentArtifacts,
    compositeArtifactIdentity: artifactIdentity,
    statePath: opts.paths.statePath,
    hostRoot: opts.paths.hostRoot,
    recordsRoot: opts.paths.recordsRoot,
    ...(opts.paths.hostConfigPath ? { hostConfigPath: opts.paths.hostConfigPath } : {}),
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
    authority,
  });
}

export async function reconcileNixosSharedHostBootstrapRecord(opts: {
  recordsRoot: string;
  deployRunId: string;
  reconciledBy: DeploymentPrincipal;
}) {
  const recordPath = deployRecordPathFor(opts.recordsRoot, opts.deployRunId);
  const record = await readNixosSharedHostDeployRecord(recordPath);
  if (!record.bootstrap) {
    throw new Error(`deploy run ${opts.deployRunId} is not a bootstrap record`);
  }
  if (record.bootstrap.reconciliation.status === "ingested") {
    return {
      record,
      recordPath,
      reconciliationPath: bootstrapReconciliationPath(opts.recordsRoot, opts.deployRunId),
    };
  }
  const reconciledAt = new Date().toISOString();
  const updated: NixosSharedHostDeployRecord = {
    ...record,
    bootstrap: {
      ...record.bootstrap,
      reconciliation: {
        status: "ingested",
        reconciledAt,
        reconciledBy: opts.reconciledBy,
      },
    },
  };
  const reconciliationPath = bootstrapReconciliationPath(opts.recordsRoot, opts.deployRunId);
  await writeControlPlaneJson(recordPath, updated);
  await writeControlPlaneJson(reconciliationPath, {
    schemaVersion: BOOTSTRAP_RECONCILIATION_SCHEMA,
    deployRunId: opts.deployRunId,
    deploymentId: updated.deploymentId,
    recordPath,
    evidencePath: updated.bootstrap.evidencePath,
    executionSnapshotPath: updated.bootstrap.executionSnapshotPath,
    reconciledAt,
    reconciledBy: opts.reconciledBy,
  });
  return { record: updated, recordPath, reconciliationPath };
}
