#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";
import {
  admitNixosSharedHostComponentArtifacts,
  compositeNixosSharedHostArtifactIdentity,
} from "./nixos-shared-host-component-artifacts.ts";
import { grantsFor } from "./deployment-control-plane-authz.ts";
import { summarizeDeploymentResult } from "./deployment-execution.ts";
import { parseComponentArtifactDirs } from "./deployment-component-artifact-dirs.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  isMultiComponentNixosSharedHostDeployment,
  primaryNixosSharedHostComponent,
} from "./nixos-shared-host-components.ts";
import {
  reconcileNixosSharedHostBootstrapRecord,
  runNixosSharedHostBootstrapDeploy,
} from "./nixos-shared-host-bootstrap.ts";
import type {
  NixosSharedHostControlPlanePaths,
  NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

async function resolveExplicitBootstrapArtifactDirs(
  deployment: NixosSharedHostDeployment,
): Promise<Record<string, string>> {
  const componentArtifactsFlag = getFlagStr("component-artifacts", "").trim();
  if (componentArtifactsFlag) return parseComponentArtifactDirs(componentArtifactsFlag);
  const artifactDir = getFlagStr("artifact-dir", "").trim();
  if (!artifactDir) {
    throw new Error(
      "bootstrap requires explicit --artifact-dir or --component-artifacts; it must not rebuild implicitly",
    );
  }
  if (isMultiComponentNixosSharedHostDeployment(deployment)) {
    throw new Error("multi-component bootstrap requires --component-artifacts");
  }
  return { [primaryNixosSharedHostComponent(deployment).id]: path.resolve(artifactDir) };
}

export async function maybeHandleNixosSharedHostBootstrapCli(opts: {
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  paths: NixosSharedHostControlPlanePaths;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
}) {
  const bootstrap = getFlagBool("bootstrap");
  const bootstrapReconcileRunId = getFlagStr("bootstrap-reconcile-run-id", "").trim();
  if (!bootstrap && !bootstrapReconcileRunId) return undefined;
  if (bootstrap && bootstrapReconcileRunId) {
    throw new Error("--bootstrap and --bootstrap-reconcile-run-id are mutually exclusive");
  }
  if (bootstrapReconcileRunId) {
    return {
      kind: "raw" as const,
      value: await reconcileNixosSharedHostBootstrapRecord({
        recordsRoot: opts.recordsRoot,
        deployRunId: bootstrapReconcileRunId,
        reconciledBy: { principalId: requireFlag("bootstrap-reconciled-by") },
      }),
    };
  }
  const artifactDirsByComponentId = await resolveExplicitBootstrapArtifactDirs(opts.deployment);
  const componentArtifacts = await admitNixosSharedHostComponentArtifacts({
    deployment: opts.deployment,
    recordsRoot: opts.recordsRoot,
    artifactDirsByComponentId,
  });
  const bootstrapPrincipal = requireFlag("bootstrap-principal");
  const result = await runNixosSharedHostBootstrapDeploy({
    deployment: opts.deployment,
    componentArtifacts,
    compositeArtifactIdentity: compositeNixosSharedHostArtifactIdentity(componentArtifacts),
    paths: opts.paths,
    authorization: grantsFor({ principalId: bootstrapPrincipal }, [
      {
        role: "bootstrap",
        scope: { kind: "bootstrap_deployment", value: opts.deployment.deploymentId },
      },
    ]),
    mode: (getFlagStr("bootstrap-mode", "first_install").trim() || "first_install") as
      | "first_install"
      | "offline_recovery",
    ownershipProof: requireFlag("bootstrap-ownership-proof"),
    targetIdentityProof: requireFlag("bootstrap-target-identity"),
    executedBy: {
      principalId: getFlagStr("bootstrap-executed-by", bootstrapPrincipal).trim(),
    },
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  });
  return {
    kind: "summary" as const,
    value: summarizeDeploymentResult(result),
  };
}
