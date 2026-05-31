import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { setupAwsTopology } from "./cloud-control-setup-aws-topology";

const CREDENTIAL_DIR = "/run/deployment-control-plane/credentials";

export function phaseMeta(id: string, input: CloudControlSetupInput) {
  const table: Record<string, { evidenceInputs: string[]; residualManualActions: string[] }> = {
    "local-review": {
      evidenceInputs: [
        "$PROFILE_ROOT/image-publication.json",
        "$PROFILE_ROOT/provider-capabilities.json",
        "$PROFILE_ROOT/ingress-checklist.json",
        "$PROFILE_ROOT/conformance-checklist.json",
      ],
      residualManualActions: [
        "review image digest, provider capability, ingress, and conformance checklist evidence",
      ],
    },
    "credential-preflight": {
      evidenceInputs: ["$PROFILE_ROOT/credential-manifest.json", CREDENTIAL_DIR],
      residualManualActions: [
        "stage every file named by credential-manifest.json on the runtime host before startup",
        "confirm reviewed-source and deployment-scoped Infisical credentials match the selected mode",
      ],
    },
    "managed-dependencies": {
      evidenceInputs: [
        "$PROFILE_ROOT/managed-dependencies.profile.yaml",
        "$PROFILE_ROOT/provider-capabilities.json#supabase-managed-postgres",
        artifactEvidence(input),
        ...supabasePrivateLinkEvidenceOutputs(input),
      ],
      residualManualActions: [
        "attach managed Postgres feature, backup, restore, and connectivity evidence",
        "attach artifact-store PUT/GET/HEAD, digest, endpoint, and VPC endpoint evidence",
        ...supabasePrivateLinkResidualActions(input),
      ],
    },
    "process-start": {
      evidenceInputs: [
        `$PROFILE_ROOT/${hostProfile(input)}`,
        "$PROFILE_ROOT/config.yaml",
        "$PROFILE_ROOT/credential-preflight.json",
        "$PROFILE_ROOT/process-service.json",
        ...processWorkerOutputPaths(input),
      ],
      residualManualActions: [
        "record supervisor or process-manager evidence for the service and each worker output path",
        "confirm config, credential, scratch, state, and cache mounts are runtime-readable only",
      ],
    },
    "http-validation": {
      evidenceInputs: [
        "$PROFILE_ROOT/ingress-checklist.json",
        "$PROFILE_ROOT/aws-topology-evidence.json",
        "$PROFILE_ROOT/managed-dependency-evidence.json",
        "$PROFILE_ROOT/process-service.json",
        ...processWorkerOutputPaths(input),
      ],
      residualManualActions: [
        "run generated DNS, TLS, health, and callback ingress evidence commands",
        "attach captured health, readiness, and worker-heartbeat responses to conformance evidence",
      ],
    },
  };
  return table[id]!;
}

export function processWorkerOutputPaths(input: CloudControlSetupInput): string[] {
  return Array.from(
    { length: input.workerReplicas },
    (_, index) => `$PROFILE_ROOT/process-worker-${index + 1}.json`,
  );
}

function artifactEvidence(input: CloudControlSetupInput): string {
  return input.artifactBackend === "aws-s3"
    ? "$PROFILE_ROOT/provider-capabilities.json#aws-s3-artifact-store"
    : "$PROFILE_ROOT/managed-dependencies.json#artifactStore.reviewedAlternateEvidence";
}

function supabasePrivateLinkEvidenceOutputs(input: CloudControlSetupInput): string[] {
  const names = [
    "support-initiation",
    "ram-acceptance",
    "vpc-lattice",
    "private-dns",
    "tcp-5432-sg",
    "private-psql",
  ];
  return usesPrivateLink(input)
    ? names.map((name) => `$PROFILE_ROOT/supabase-privatelink-${name}.json`)
    : [];
}

function supabasePrivateLinkResidualActions(input: CloudControlSetupInput): string[] {
  return usesPrivateLink(input)
    ? ["run generated Supabase PrivateLink operator-evidence commands from commands.json"]
    : [];
}

function usesPrivateLink(input: CloudControlSetupInput): boolean {
  return input.mode === "aws-ec2" && setupAwsTopology(input)?.database?.mode === "privatelink";
}

function hostProfile(input: CloudControlSetupInput): string {
  if (input.mode === "aws-ec2") return "aws-ec2-profile.yaml";
  if (input.mode === "saas-oci") return "saas-oci-profile.yaml";
  if (input.mode === "nixos") return "nixos-module.example.nix";
  return "compose.yaml";
}
