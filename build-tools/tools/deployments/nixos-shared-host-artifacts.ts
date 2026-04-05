#!/usr/bin/env zx-wrapper
import {
  STATIC_WEBAPP_ARTIFACT_PROVENANCE_SCHEMA,
  admitStaticWebappArtifact,
  artifactIdentityForStaticWebappDir,
  requireAdmittedStaticWebappArtifactPath,
  type AdmittedStaticWebappArtifact,
} from "./static-webapp-artifacts.ts";

export const NIXOS_SHARED_HOST_ARTIFACT_PROVENANCE_SCHEMA =
  STATIC_WEBAPP_ARTIFACT_PROVENANCE_SCHEMA;

export type NixosSharedHostAdmittedArtifact = AdmittedStaticWebappArtifact;

export async function admitNixosSharedHostStaticArtifact(opts: {
  recordsRoot: string;
  artifactDir: string;
}): Promise<NixosSharedHostAdmittedArtifact> {
  return await admitStaticWebappArtifact(opts);
}

export async function requireNixosSharedHostAdmittedArtifactPath(
  artifact: NixosSharedHostAdmittedArtifact,
): Promise<string> {
  return await requireAdmittedStaticWebappArtifactPath(artifact);
}

export { artifactIdentityForStaticWebappDir };
