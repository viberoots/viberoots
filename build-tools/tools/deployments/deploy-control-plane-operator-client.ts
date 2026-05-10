import path from "node:path";
import { getFlagStr, hasFlag } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import {
  readNixosSharedHostControlPlaneRecordViaService,
  readNixosSharedHostControlPlaneStatusViaService,
} from "./nixos-shared-host-control-plane-client";
import { readNixosSharedHostClientProfile } from "./nixos-shared-host-install-dev-machine";
import {
  resolveServiceClientFromFlags,
  resolveServiceClientFromManifest,
} from "./nixos-shared-host-service-client-config";

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
    const profile = await readNixosSharedHostClientProfile({
      outputRoot: resolveProfileRoot(opts.workspaceRoot),
      profileName: requireProfileName(),
    });
    return resolveServiceClientFromManifest(profile.manifest);
  }
  return resolveServiceClientFromFlags({
    controlPlaneUrl:
      getFlagStr("control-plane-url", "").trim() ||
      String(process.env.VBR_DEPLOY_CONTROL_PLANE_URL || "").trim(),
    controlPlaneToken: getFlagStr("control-plane-token", "").trim() || undefined,
    remote: getFlagStr("remote", "").trim(),
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
