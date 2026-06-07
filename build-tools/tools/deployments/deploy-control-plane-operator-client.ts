import path from "node:path";
import { getFlagBool, getFlagStr, hasFlag } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import {
  readNixosSharedHostControlPlaneRecordViaService,
  readNixosSharedHostControlPlaneStatusViaService,
} from "./nixos-shared-host-control-plane-client";
import {
  readNixosSharedHostCurrentStageStateViaService,
  readNixosSharedHostStageStateAuditViaService,
  readNixosSharedHostStageHistoryViaService,
} from "./nixos-shared-host-control-plane-stage-client";
import { readNixosSharedHostClientProfile } from "./nixos-shared-host-install-dev-machine";
import { resolveServiceClientFromManifest } from "./nixos-shared-host-service-client-config";
import { resolveProtectedSharedServiceClient } from "./deployment-service-client-selection";

export type RunSelector = { submissionId?: string; deployRunId?: string };

export function requireLookupSelector(actionLabel: string): RunSelector {
  const submissionId = getFlagStr("submission-id", "").trim();
  const deployRunId = getFlagStr("deploy-run-id", "").trim();
  if (submissionId && deployRunId) {
    throw new Error(`${actionLabel} accepts either --submission-id or --deploy-run-id, not both`);
  }
  if (!submissionId && !deployRunId) {
    throw new Error(`${actionLabel} requires --submission-id or --deploy-run-id`);
  }
  return {
    ...(submissionId ? { submissionId } : {}),
    ...(deployRunId ? { deployRunId } : {}),
  };
}

function requireProfileName(): string {
  const profileName = getFlagStr("profile", "").trim();
  if (!profileName) throw new Error("service-backed profile lookup requires --profile <name>");
  return profileName;
}

function resolveProfileRoot(workspaceRoot: string): string {
  const profileRoot = getFlagStr("profile-root", "").trim();
  return profileRoot
    ? path.resolve(profileRoot)
    : path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host", "clients");
}

export async function resolveServiceClientForOperator(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  actionLabel: string;
}) {
  if (hasFlag("profile") || hasFlag("profile-root")) {
    if (opts.deployment.controlPlane) {
      throw new Error(
        `${opts.actionLabel} cannot use --profile/--profile-root when deployment context selects a controlPlane`,
      );
    }
    const profile = await readNixosSharedHostClientProfile({
      outputRoot: resolveProfileRoot(opts.workspaceRoot),
      profileName: requireProfileName(),
    });
    return {
      ...resolveServiceClientFromManifest(profile.manifest),
      selectedSource: "explicit" as const,
    };
  }
  return await resolveProtectedSharedServiceClient({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.deployment,
    controlPlaneUrl: getFlagStr("control-plane-url", "").trim(),
    controlPlaneToken: getFlagStr("control-plane-token", "").trim() || undefined,
    remote: getFlagStr("remote", "").trim(),
    allowControlPlaneOverride: getFlagBool("allow-control-plane-override"),
    context: opts.actionLabel,
  });
}

async function readWithRetry<T>(opts: {
  read: () => Promise<T>;
  timeoutMs: number;
  retryableMessage: string;
}) {
  const deadline = Date.now() + opts.timeoutMs;
  while (true) {
    try {
      return await opts.read();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes(opts.retryableMessage) ||
        Date.now() >= deadline
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export async function readStatusForOperator(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  selector: RunSelector;
}) {
  return await readWithRetry({
    timeoutMs: 1_500,
    retryableMessage: "submission not found",
    read: async () =>
      await readNixosSharedHostControlPlaneStatusViaService({
        controlPlaneUrl: opts.controlPlaneUrl,
        ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
        ...opts.selector,
      }),
  });
}

export async function readRecordForOperator(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  selector: RunSelector;
}) {
  return await readWithRetry({
    timeoutMs: 3_000,
    retryableMessage: "record not found",
    read: async () =>
      await readNixosSharedHostControlPlaneRecordViaService({
        controlPlaneUrl: opts.controlPlaneUrl,
        ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
        ...opts.selector,
      }),
  });
}

export async function readCurrentStageStateForOperator(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deploymentId?: string;
  environmentStage?: string;
}) {
  return await readNixosSharedHostCurrentStageStateViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
    ...(opts.deploymentId ? { deploymentId: opts.deploymentId } : {}),
    ...(opts.environmentStage ? { environmentStage: opts.environmentStage } : {}),
  });
}

export async function readStageHistoryForOperator(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deploymentId: string;
  environmentStage: string;
}) {
  return await readNixosSharedHostStageHistoryViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
    deploymentId: opts.deploymentId,
    environmentStage: opts.environmentStage,
  });
}

export async function readStageStateAuditForOperator(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deploymentId: string;
  environmentStage: string;
}) {
  return await readNixosSharedHostStageStateAuditViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
    deploymentId: opts.deploymentId,
    environmentStage: opts.environmentStage,
  });
}
