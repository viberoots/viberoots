#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";

export function artifactOutcomeFields(opts: {
  artifactIdentity?: string;
  artifact?: NixosSharedHostAdmittedArtifact;
  artifactLineageId?: string;
}) {
  return {
    ...(opts.artifactIdentity ? { artifactIdentity: opts.artifactIdentity } : {}),
    ...(opts.artifact?.storedArtifactPath
      ? { artifactStoredArtifactPath: opts.artifact.storedArtifactPath }
      : {}),
    ...(opts.artifact?.provenancePath
      ? { artifactProvenancePath: opts.artifact.provenancePath }
      : {}),
    ...(opts.artifactLineageId || opts.artifactIdentity
      ? { artifactLineageId: opts.artifactLineageId || opts.artifactIdentity }
      : {}),
  };
}
