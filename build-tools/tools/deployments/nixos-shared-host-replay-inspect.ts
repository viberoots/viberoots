#!/usr/bin/env zx-wrapper
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getFlagStr, hasFlag } from "../lib/cli.ts";
import {
  nixosSharedHostReplayArtifactIdentity,
  resolveNixosSharedHostReplaySource,
} from "./nixos-shared-host-replay.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

function requireBackendDatabaseUrl(): string {
  const value =
    getFlagStr("control-plane-database-url", "").trim() ||
    String(process.env.BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL || "").trim();
  if (!value) {
    throw new Error(
      "shared replay inspect requires --control-plane-database-url or BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL",
    );
  }
  return value;
}

export async function inspectNixosSharedHostReplay(opts: {
  recordsRoot: string;
  backendDatabaseUrl: string;
  deployRunId: string;
}) {
  const resolved = await resolveNixosSharedHostReplaySource({
    recordsRoot: path.resolve(opts.recordsRoot),
    backendDatabaseUrl: opts.backendDatabaseUrl,
    deployRunId: opts.deployRunId,
  });
  return {
    deployRunId: resolved.record.deployRunId,
    deploymentLabel: resolved.record.deploymentLabel,
    providerTargetIdentity: resolved.replaySnapshot.providerTargetIdentity,
    deploymentMetadataFingerprint: resolved.replaySnapshot.deploymentMetadataFingerprint,
    admittedContext: resolved.replaySnapshot.admittedContext,
    replaySnapshotPath: resolved.record.replaySnapshotPath,
    platformStateSnapshotPath: resolved.replaySnapshot.platformStateSnapshotPath,
    hostConfigSnapshotPath: resolved.replaySnapshot.hostConfigSnapshotPath,
    artifactIdentity: nixosSharedHostReplayArtifactIdentity(resolved.replaySnapshot),
    publishInput: resolved.replaySnapshot.publishInput,
    componentResults: resolved.replaySnapshot.componentResults,
    ...(resolved.replaySnapshot.publishInput.kind === "exact-artifact"
      ? {
          artifact: {
            identity: resolved.replaySnapshot.publishInput.artifact.identity,
            storedArtifactPath: resolved.artifactDir,
            provenancePath: resolved.replaySnapshot.publishInput.artifact.provenancePath,
          },
        }
      : {}),
  };
}

async function main() {
  if (hasFlag("record-path")) {
    throw new Error("shared replay inspect no longer accepts --record-path");
  }
  console.log(
    JSON.stringify(
      await inspectNixosSharedHostReplay({
        recordsRoot: requireFlag("records-root"),
        backendDatabaseUrl: requireBackendDatabaseUrl(),
        deployRunId: requireFlag("deploy-run-id"),
      }),
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
