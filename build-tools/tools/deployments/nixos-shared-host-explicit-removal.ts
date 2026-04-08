#!/usr/bin/env zx-wrapper
import {
  requireNixosSharedHostControlPlaneAuthority,
  type NixosSharedHostMutationAuthority,
} from "./nixos-shared-host-control-plane-contract.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  readNixosSharedHostPlatformStateOrEmpty,
  writeJsonDocument,
} from "./nixos-shared-host-io.ts";
import { removeNixosSharedHostPlatformDeployment } from "./nixos-shared-host-platform.ts";
import {
  createNixosSharedHostDeployRecord,
  createNixosSharedHostDeployRunId,
  type NixosSharedHostDeployRecord,
  writeNixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";
import { materializeNixosSharedHostRuntime } from "./nixos-shared-host-runtime.ts";
import { renderNixosSharedHostConfig } from "./nixos-shared-host.ts";

export async function runNixosSharedHostExplicitRemoval(opts: {
  deployment: NixosSharedHostDeployment;
  statePath: string;
  hostRoot: string;
  recordsRoot: string;
  deployBatchId?: string;
  hostConfigPath?: string;
  authority?: NixosSharedHostMutationAuthority;
  provisionerPlan?: import("./nixos-shared-host-provisioner-plan.ts").NixosSharedHostProvisionerPlanRef;
}): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string }> {
  const authority = requireNixosSharedHostControlPlaneAuthority(opts.deployment, opts.authority);
  const runId = createNixosSharedHostDeployRunId("remove");
  try {
    const current = await readNixosSharedHostPlatformStateOrEmpty(opts.statePath);
    const state = removeNixosSharedHostPlatformDeployment(current, opts.deployment.deploymentId);
    await writeJsonDocument(opts.statePath, state);
    const rendered = renderNixosSharedHostConfig(state);
    if (opts.hostConfigPath) await writeJsonDocument(opts.hostConfigPath, rendered);
    await materializeNixosSharedHostRuntime(opts.hostRoot, rendered);
    const record = createNixosSharedHostDeployRecord(opts.deployment, {
      deployRunId: runId,
      runClassification: "explicit_removal",
      finalOutcome: "succeeded",
      ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
      ...(opts.provisionerPlan ? { provisionerPlan: opts.provisionerPlan } : {}),
      authority,
    });
    return { record, recordPath: await writeNixosSharedHostDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const record = createNixosSharedHostDeployRecord(opts.deployment, {
      deployRunId: runId,
      runClassification: "explicit_removal",
      finalOutcome: "provision_failed",
      ...(opts.deployBatchId ? { deployBatchId: opts.deployBatchId } : {}),
      ...(opts.provisionerPlan ? { provisionerPlan: opts.provisionerPlan } : {}),
      failedStep: "provision",
      error: message,
      authority,
    });
    const recordPath = await writeNixosSharedHostDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      record,
      recordPath,
    });
  }
}
