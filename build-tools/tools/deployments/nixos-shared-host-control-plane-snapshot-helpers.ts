#!/usr/bin/env zx-wrapper
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results";
import {
  compositeNixosSharedHostArtifactIdentity,
  type NixosSharedHostResolvedComponentArtifact,
} from "./nixos-shared-host-component-artifacts";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts";
import type { NixosSharedHostControlPlaneSourceSelection } from "./nixos-shared-host-control-plane-snapshot";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay";
import type { NixosSharedHostPublishInput } from "./nixos-shared-host-publish-input";

export function recordedComponentResults(
  source?: NixosSharedHostControlPlaneSourceSelection,
): NixosSharedHostComponentResult[] | undefined {
  return source?.replaySnapshot?.componentResults;
}

export function publishInputFor(opts: {
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
}): NixosSharedHostPublishInput | undefined {
  if (opts.componentArtifacts?.length) {
    return {
      kind: "component-artifacts",
      components: opts.componentArtifacts,
      compositeArtifactIdentity: compositeNixosSharedHostArtifactIdentity(opts.componentArtifacts),
    };
  }
  if (!opts.artifact) return undefined;
  return { kind: "exact-artifact", artifact: opts.artifact as NixosSharedHostAdmittedArtifact };
}

export function hasReplaySnapshot(
  source?: NixosSharedHostControlPlaneSourceSelection,
): source is NixosSharedHostControlPlaneSourceSelection & {
  record: NixosSharedHostDeployRecord;
  replaySnapshot: NixosSharedHostReplaySnapshot;
} {
  return !!source?.replaySnapshot;
}

export function createNixosSharedHostWorkerId(submissionId: string): string {
  return `${submissionId}-worker`;
}
