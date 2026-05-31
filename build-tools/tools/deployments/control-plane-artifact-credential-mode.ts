#!/usr/bin/env zx-wrapper
import type { ArtifactBackend } from "./cloud-control-setup-types";

export const ARTIFACT_CREDENTIAL_MODES = ["files", "aws-instance-profile"] as const;

export type ArtifactCredentialMode = (typeof ARTIFACT_CREDENTIAL_MODES)[number];

export const ARTIFACT_CREDENTIAL_FILE_NAMES = [
  "artifact-store-endpoint",
  "artifact-store-access-key-id",
  "artifact-store-secret-access-key",
] as const;

export function artifactCredentialMode(value: unknown): ArtifactCredentialMode {
  if (value === undefined) return "files";
  if (ARTIFACT_CREDENTIAL_MODES.includes(value as ArtifactCredentialMode)) {
    return value as ArtifactCredentialMode;
  }
  throw new Error("storage.artifactStore.credentialMode has unsupported value");
}

export function assertArtifactCredentialModeAllowed(opts: {
  provider: ArtifactBackend;
  credentialMode: ArtifactCredentialMode;
  fieldName?: string;
}): void {
  if (opts.credentialMode === "aws-instance-profile" && opts.provider !== "aws-s3") {
    throw new Error(
      `${opts.fieldName || "artifact credential mode"} aws-instance-profile requires aws-s3`,
    );
  }
}

export function artifactCredentialFiles(mode: ArtifactCredentialMode): string[] {
  return mode === "aws-instance-profile"
    ? [ARTIFACT_CREDENTIAL_FILE_NAMES[0]]
    : [...ARTIFACT_CREDENTIAL_FILE_NAMES];
}
