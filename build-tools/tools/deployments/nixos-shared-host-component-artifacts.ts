#!/usr/bin/env zx-wrapper
import {
  admitNixosSharedHostArtifact,
  type NixosSharedHostAdmittedArtifact,
} from "./nixos-shared-host-artifacts.ts";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";

export type NixosSharedHostResolvedComponentArtifact = {
  componentId: string;
  artifact: NixosSharedHostAdmittedArtifact;
};

export async function admitNixosSharedHostComponentArtifacts(opts: {
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  artifactDirsByComponentId: Record<string, string>;
}): Promise<NixosSharedHostResolvedComponentArtifact[]> {
  const resolved: NixosSharedHostResolvedComponentArtifact[] = [];
  for (const component of opts.deployment.components) {
    const artifactDir = opts.artifactDirsByComponentId[component.id];
    if (!artifactDir) {
      throw new Error(`missing artifact dir for component "${component.id}"`);
    }
    resolved.push({
      componentId: component.id,
      artifact: await admitNixosSharedHostArtifact({
        recordsRoot: opts.recordsRoot,
        artifactDir,
        kind: component.kind,
      }),
    });
  }
  return resolved;
}

export function compositeNixosSharedHostArtifactIdentity(
  artifacts: NixosSharedHostResolvedComponentArtifact[],
): string {
  return `nixos-shared-host-release:${fingerprintValue(
    artifacts.map(({ componentId, artifact }) => ({
      componentId,
      artifactIdentity: artifact.identity,
    })),
  ).slice("sha256:".length)}`;
}
