import type { ProviderCapabilityDeclaration } from "./cloud-control-setup-types";

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

export const CLOUD_CAPABILITY_IDS = [
  "aws-ec2-control-plane-host",
  "aws-attic-cache-service",
  "aws-s3-artifact-store",
  "aws-network-foundation",
  "supabase-managed-postgres",
  "supabase-privatelink-prerequisite",
  "cloudflare-edge",
  "vercel-operator-ui",
  "remote-build-worker-fleet",
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

export function capabilityDeclaration(id: string): ProviderCapabilityDeclaration {
  return {
    id,
    targetIdentity: `${id}:<reviewed-account-or-project>/<reviewed-region>/<reviewed-name>`,
    credentialSource: "file-backed runtime credential or reviewed prerequisite evidence only",
    lockScope: `provider-capability:${id}:<target-identity>`,
    previewDiffBehavior: "reviewed IaC preview/diff must run before protected/shared apply",
    mutationSequence: [
      "admission revalidation",
      "provider lock acquisition",
      "reviewed IaC or provider CLI preview",
      "operator approval",
      "idempotent apply",
      "smoke check",
      "audit evidence capture",
    ],
    smokeChecks: ["health/readiness check", "provider identity check", "audit evidence check"],
    rollbackProcedure: [
      "restore last reviewed IaC state or provider snapshot",
      "record rollback evidence",
      "rerun smoke checks",
    ],
    replaySemantics: "replay uses durable records and immutable artifacts, not dashboard state",
    auditEvidence: ["preview output digest", "apply result digest", "smoke result", "operator id"],
    protectedSharedEligibility: "blocked until every selected prerequisite has evidence",
    iac: {
      reviewedReference: `iac/${id}/README.md`,
      previewCommand: `deploy --deployment <label> --preview --provider-capability ${id}`,
      applyCommand: `deploy --deployment <label> --provider-capability ${id}`,
      evidenceCommand: `deploy --deployment <label> --record --provider-capability ${id}`,
    },
  };
}
