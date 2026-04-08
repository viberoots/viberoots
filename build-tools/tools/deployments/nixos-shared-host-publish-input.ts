#!/usr/bin/env zx-wrapper
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";

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
