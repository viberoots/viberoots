#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  readNixosSharedHostPlatformStateOrEmpty,
  writeJsonDocument,
} from "./nixos-shared-host-io.ts";
import { applyNixosSharedHostScopedDeployments } from "./nixos-shared-host-platform.ts";
import { renderNixosSharedHostConfig } from "./nixos-shared-host.ts";
import {
  createNixosSharedHostDeployRecord,
  createNixosSharedHostDeployRunId,
  type NixosSharedHostDeployRecord,
  writeNixosSharedHostDeployRecord,
} from "./nixos-shared-host-records.ts";
import {
  materializeNixosSharedHostRuntime,
  nixosSharedHostContainerRoot,
} from "./nixos-shared-host-runtime.ts";
import { publishNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-publisher.ts";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke.ts";

export async function runNixosSharedHostStaticDeploy(opts: {
  deployment: NixosSharedHostDeployment;
  artifactDir: string;
  statePath: string;
  hostRoot: string;
  recordsRoot: string;
  hostConfigPath?: string;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string }> {
  const runId = createNixosSharedHostDeployRunId();
  const current = await readNixosSharedHostPlatformStateOrEmpty(opts.statePath);
  const state = applyNixosSharedHostScopedDeployments(current, [opts.deployment]);
  await writeJsonDocument(opts.statePath, state);
  const rendered = renderNixosSharedHostConfig(state);
  if (opts.hostConfigPath) await writeJsonDocument(opts.hostConfigPath, rendered);
  await materializeNixosSharedHostRuntime(opts.hostRoot, rendered);
  try {
    const container = rendered.containers[opts.deployment.providerTarget.containerName];
    const published = await publishNixosSharedHostStaticWebapp({
      artifactDir: opts.artifactDir,
      containerRoot: nixosSharedHostContainerRoot(opts.hostRoot, container.containerName),
      layout: {
        releaseRoot: container.releaseRoot,
        publishRoot: container.publishRoot,
        activeReleaseLink: container.activeReleaseLink,
      },
    });
    const smoke = await smokeNixosSharedHostStaticWebapp({
      hostname: opts.deployment.providerTarget.hostname,
      indexPath: published.indexPath,
      healthPath: opts.deployment.runtime.healthPath,
      connectOverride: opts.smokeConnectOverride,
    });
    const record = createNixosSharedHostDeployRecord(opts.deployment, {
      runId,
      finalOutcome: "succeeded",
      artifactIdentity: published.artifactIdentity,
      publicUrl: smoke.publicUrl,
      healthUrl: smoke.healthUrl,
    });
    return { record, recordPath: await writeNixosSharedHostDeployRecord(opts.recordsRoot, record) };
  } catch (error) {
    const record = createNixosSharedHostDeployRecord(opts.deployment, {
      runId,
      finalOutcome: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    const recordPath = await writeNixosSharedHostDeployRecord(opts.recordsRoot, record);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      record,
      recordPath,
    });
  }
}
