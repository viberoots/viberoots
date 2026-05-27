import {
  assertCredentialDirectoryPath,
  type CredentialPathPolicy,
} from "./control-plane-runtime-config-paths";
import type { ControlPlaneReviewedSourceConfig } from "./control-plane-runtime-config-types";

export function normalizeRuntimeReviewedSource(value: unknown): ControlPlaneReviewedSourceConfig {
  const reviewedSource = objectValue(value, "reviewedSource");
  const mode = enumValue(
    reviewedSource.mode ?? "ssh",
    ["ssh", "github-app"],
    "reviewedSource.mode",
  );
  if (mode === "github-app") {
    rejectPresentFields(reviewedSource, ["sshKeyFile", "sshKnownHostsFile"], mode);
    return {
      mode,
      githubAppIdFile: stringValue(
        reviewedSource.githubAppIdFile,
        "reviewedSource.githubAppIdFile",
      ),
      githubAppInstallationIdFile: stringValue(
        reviewedSource.githubAppInstallationIdFile,
        "reviewedSource.githubAppInstallationIdFile",
      ),
      githubAppPrivateKeyFile: stringValue(
        reviewedSource.githubAppPrivateKeyFile,
        "reviewedSource.githubAppPrivateKeyFile",
      ),
    };
  }
  rejectPresentFields(
    reviewedSource,
    ["githubAppIdFile", "githubAppInstallationIdFile", "githubAppPrivateKeyFile"],
    mode,
  );
  return {
    mode,
    sshKeyFile: stringValue(reviewedSource.sshKeyFile, "reviewedSource.sshKeyFile"),
    sshKnownHostsFile: stringValue(
      reviewedSource.sshKnownHostsFile,
      "reviewedSource.sshKnownHostsFile",
    ),
  };
}

function rejectPresentFields(value: Record<string, unknown>, fields: string[], mode: string): void {
  const present = fields.filter((field) => String(value[field] || "").trim() !== "");
  if (present.length > 0) {
    throw new Error(
      `reviewedSource mode ${mode} cannot include credentials for another mode: ${present.join(", ")}`,
    );
  }
}

export function resolveRuntimeReviewedSource(
  config: ControlPlaneReviewedSourceConfig,
  policy: CredentialPathPolicy,
): ControlPlaneReviewedSourceConfig {
  if (config.mode === "github-app") {
    return {
      mode: config.mode,
      githubAppIdFile: assertCredentialDirectoryPath(config.githubAppIdFile, policy),
      githubAppInstallationIdFile: assertCredentialDirectoryPath(
        config.githubAppInstallationIdFile,
        policy,
      ),
      githubAppPrivateKeyFile: assertCredentialDirectoryPath(
        config.githubAppPrivateKeyFile,
        policy,
      ),
    };
  }
  return {
    mode: config.mode,
    sshKeyFile: assertCredentialDirectoryPath(config.sshKeyFile, policy),
    sshKnownHostsFile: assertCredentialDirectoryPath(config.sshKnownHostsFile, policy),
  };
}

function objectValue(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${fieldName} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${fieldName} must be a non-empty string`);
  return value;
}

function enumValue<T extends string>(value: unknown, choices: T[], fieldName: string): T {
  if (typeof value !== "string" || !choices.includes(value as T))
    throw new Error(`${fieldName} has unsupported value`);
  return value as T;
}
