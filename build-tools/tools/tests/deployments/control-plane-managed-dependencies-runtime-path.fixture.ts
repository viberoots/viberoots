#!/usr/bin/env zx-wrapper
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import type { ManagedDependencyEvidence } from "../../deployments/control-plane-managed-dependency-types";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import { buildSupabaseManagedPostgresEvidence } from "../../deployments/control-plane-supabase-postgres-evidence";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST = `sha256:${"b".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"c".repeat(64)}`;

export function profileYaml(mode: "public" | "privatelink"): string {
  return `
profileName: aws-runtime-review
supabasePostgres: ${JSON.stringify(privateLinkSupabaseProfile())}
runtimePath:
  expectedHostProfile: aws-ec2
  expectedAwsRegion: us-east-1
  databaseConnectivityMode: ${mode}
  expectedSupabaseProjectRef: projectref
  expectedSupabaseRegion: us-east-1
  expectedPrivateLinkEndpointId: vpce-privatelink123
  expectedS3VpcEndpointId: vpce-123
  expectedAlternateBackendEvidenceRef: reviewed-alt
  expectedAlternateBackendEvidenceDigest: sha256:alternate
postgres:
  provider: supabase-postgres
  urlFile: /run/deployment-control-plane/credentials/control-plane-database-url
artifactStore:
  provider: aws-s3
  credentialMode: files
  bucket: deployment-control-plane-artifacts
  region: us-east-1
  endpointFile: /run/deployment-control-plane/credentials/artifact-store-endpoint
  accessKeyIdFile: /run/deployment-control-plane/credentials/artifact-store-access-key-id
  secretAccessKeyFile: /run/deployment-control-plane/credentials/artifact-store-secret-access-key
`;
}

export function evidence(
  overrides: Partial<ManagedDependencyEvidence> = {},
): ManagedDependencyEvidence {
  return {
    schemaVersion: "control-plane-managed-dependency-evidence@1",
    profileName: "aws-runtime-review",
    checkedAt: new Date().toISOString(),
    supabasePostgres: buildSupabaseManagedPostgresEvidence(privateLinkSupabaseProfile()),
    runtimePath: baseRuntimePath(),
    postgres: basePostgres(),
    artifactStore: baseArtifactStore(),
    ...overrides,
  };
}

export function baseRuntimePath(): ManagedDependencyEvidence["runtimePath"] {
  return {
    hostProfile: "aws-ec2",
    awsRegion: "us-east-1",
    databaseConnectivityMode: "privatelink",
    sourceHostIdentity: "i-0abc1234",
    sourceHostKind: "aws-ec2",
    supabaseProjectRef: "projectref",
    supabaseRegion: "us-east-1",
    privatelinkEndpointId: "vpce-privatelink123",
  };
}

export function basePostgres(): ManagedDependencyEvidence["postgres"] {
  return {
    provider: "supabase-postgres",
    serverVersionNum: 150000,
    checkedFeatures: ["jsonb"],
    resolvedHost: "vpce-privatelink123.vpce.amazonaws.com",
    tlsEnabled: true,
    peerHostIdentity: "vpce-privatelink123.vpce.amazonaws.com",
    databaseConnectivityMode: "privatelink",
    sourceHostIdentity: "i-0abc1234",
    sourceHostKind: "aws-ec2",
    supabaseProjectRef: "projectref",
    supabaseRegion: "us-east-1",
    privatelinkEndpointId: "vpce-privatelink123",
  };
}

export function baseArtifactStore(): ManagedDependencyEvidence["artifactStore"] {
  return {
    provider: "aws-s3",
    bucket: "deployment-control-plane-artifacts",
    region: "us-east-1",
    endpointHost: "s3.us-east-1.amazonaws.com",
    sourceHostIdentity: "i-0abc1234",
    sourceHostKind: "aws-ec2",
    s3VpcEndpointId: "vpce-123",
    s3EndpointPolicyDigest: "sha256:s3-endpoint-policy",
    artifactCredentialMode: "files",
    checkedOperations: ["PUT", "GET", "HEAD", "metadata", "content-type", "digest"],
    digest: "sha256:artifact-store-proof",
    objectKey: "control-plane/proof",
  };
}

export function setupInput(): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: DIGEST_REF,
      sourceRevision: "source-review",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-review",
      evidenceSource: "generated-command",
      registryProfile: ecrRegistryProfileForImage(DIGEST_REF, DIGEST),
    },
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: topologyForImage(),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
  };
}

function topologyForImage() {
  return topologyForPublishedImage(privateLinkAwsTopology(), DIGEST_REF, DIGEST);
}
