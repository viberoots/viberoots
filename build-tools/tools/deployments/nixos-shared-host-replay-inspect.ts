#!/usr/bin/env zx-wrapper
import path from "node:path";
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

function resolveReplaySelection():
  | { recordPath: string }
  | { recordsRoot: string; deployRunId: string } {
  if (hasFlag("record-path")) {
    return { recordPath: path.resolve(requireFlag("record-path")) };
  }
  return {
    recordsRoot: path.resolve(requireFlag("records-root")),
    deployRunId: requireFlag("deploy-run-id"),
  };
}

async function main() {
  const resolved = await resolveNixosSharedHostReplaySource(resolveReplaySelection());
  console.log(
    JSON.stringify(
      {
        deployRunId: resolved.record.deployRunId,
        recordPath: resolved.recordPath,
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
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
