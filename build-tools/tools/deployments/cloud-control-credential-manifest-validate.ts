import type { CloudControlSetupInput, ReviewedSourceMode } from "./cloud-control-setup-types";
import {
  CREDENTIAL_FILENAMES,
  GITHUB_APP_FILENAMES,
  INFISICAL_FILENAMES,
  SSH_REVIEWED_SOURCE_FILENAMES,
} from "./cloud-control-setup-contract";
import { artifactCredentialFiles } from "./control-plane-artifact-credential-mode";

export function validateCredentialManifestFiles(
  files: readonly string[],
  reviewedSourceMode: ReviewedSourceMode = "ssh",
  artifactCredentialMode: NonNullable<CloudControlSetupInput["artifactCredentialMode"]> = "files",
): string[] {
  const errors: string[] = [];
  const required = baseCredentialFiles(reviewedSourceMode, artifactCredentialMode);
  for (const file of required) {
    if (!files.includes(file)) errors.push(`credential manifest missing ${file}`);
  }
  if (files.some((file) => /^env:/i.test(file))) {
    errors.push("credential manifest must not use env-var-only secret modes");
  }
  return errors;
}

function baseCredentialFiles(
  reviewedSourceMode: ReviewedSourceMode,
  artifactCredentialMode: NonNullable<CloudControlSetupInput["artifactCredentialMode"]>,
): string[] {
  const artifact = new Set(artifactCredentialFiles(artifactCredentialMode));
  return [
    ...CREDENTIAL_FILENAMES.filter(
      (name) => !name.startsWith("artifact-store-") || artifact.has(name),
    ),
    ...INFISICAL_FILENAMES,
    ...(reviewedSourceMode === "github-app" ? GITHUB_APP_FILENAMES : SSH_REVIEWED_SOURCE_FILENAMES),
  ];
}
