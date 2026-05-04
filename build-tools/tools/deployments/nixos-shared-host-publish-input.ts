#!/usr/bin/env zx-wrapper
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts";

export type NixosSharedHostPublishInput =
  | {
      kind: "exact-artifact";
      artifact: NixosSharedHostAdmittedArtifact;
    }
  | {
      kind: "component-artifacts";
      components: NixosSharedHostResolvedComponentArtifact[];
      compositeArtifactIdentity: string;
    };

export function nixosSharedHostPublishInputArtifactIdentity(
  publishInput: NixosSharedHostPublishInput,
): string {
  return publishInput.kind === "exact-artifact"
    ? publishInput.artifact.identity
    : publishInput.compositeArtifactIdentity;
}
