import {
  capabilityDeclaration,
  CLOUD_CAPABILITY_IDS,
  CONCRETE_PROVIDER_CAPABILITIES,
} from "./cloud-control-provider-capabilities";

export { capabilityDeclaration, CLOUD_CAPABILITY_IDS, CONCRETE_PROVIDER_CAPABILITIES };

export const CREDENTIAL_FILENAMES = [
  "control-plane-database-url",
  "control-plane-token",
  "artifact-store-endpoint",
  "artifact-store-access-key-id",
  "artifact-store-secret-access-key",
] as const;

export const SSH_REVIEWED_SOURCE_FILENAMES = [
  "reviewed-source-ssh-key",
  "reviewed-source-known-hosts",
] as const;

export const GITHUB_APP_FILENAMES = [
  "reviewed-source-github-app-id",
  "reviewed-source-github-app-installation-id",
  "reviewed-source-github-app-private-key",
] as const;

export const INFISICAL_FILENAMES = [
  "{deploymentId}-infisical-client-id",
  "{deploymentId}-infisical-client-secret",
] as const;

export const REQUIRED_CAPABILITY_FIELDS = [
  "targetIdentity",
  "credentialSource",
  "lockScope",
  "previewDiffBehavior",
  "mutationSequence",
  "smokeChecks",
  "rollbackProcedure",
  "replaySemantics",
  "auditEvidence",
  "protectedSharedEligibility",
] as const;
