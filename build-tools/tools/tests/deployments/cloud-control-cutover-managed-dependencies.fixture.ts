#!/usr/bin/env zx-wrapper
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";
import { buildSupabaseManagedPostgresEvidence } from "../../deployments/control-plane-supabase-postgres-evidence";

export function managedDependencyEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "control-plane-managed-dependency-evidence@1",
    profileName: "cloud-control-plane",
    checkedAt: new Date().toISOString(),
    supabasePostgres: buildSupabaseManagedPostgresEvidence(
      reviewedSupabaseManagedPostgresProfile({
        instanceId: "cloud-control-plane",
        region: "us-east-1",
        mode: "privatelink",
        organizationId: "org-control-plane-prod",
        projectRef: "project-review",
      }),
    ),
    runtimePath: {
      hostProfile: "aws-ec2",
      awsRegion: "us-east-1",
      databaseConnectivityMode: "privatelink",
      sourceHostIdentity: "i-0abc1234",
      sourceHostKind: "aws-ec2",
      supabaseProjectRef: "project-review",
      supabaseRegion: "us-east-1",
      privatelinkEndpointId: "vpce-privatelink123",
      expectedArtifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
      expectedArtifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
    },
    postgres: {
      provider: "supabase-postgres",
      serverVersionNum: 150000,
      checkedFeatures: ["jsonb", "listen-notify"],
      resolvedHost: "vpce-privatelink123.vpce.amazonaws.com",
      tlsEnabled: true,
      peerHostIdentity: "vpce-privatelink123.vpce.amazonaws.com",
      databaseConnectivityMode: "privatelink",
      sourceHostIdentity: "i-0abc1234",
      sourceHostKind: "aws-ec2",
      supabaseProjectRef: "project-review",
      supabaseRegion: "us-east-1",
      privatelinkEndpointId: "vpce-privatelink123",
    },
    artifactStore: {
      provider: "aws-s3",
      bucket: "deployment-control-plane-artifacts",
      region: "us-east-1",
      endpointHost: "s3.us-east-1.amazonaws.com",
      sourceHostIdentity: "i-0abc1234",
      sourceHostKind: "aws-ec2",
      s3VpcEndpointId: "vpce-123",
      s3EndpointPolicyDigest: "sha256:s3-endpoint-policy",
      artifactCredentialMode: "aws-instance-profile",
      expectedArtifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
      observedArtifactIamRoleName: "control-plane-host",
      artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
      checkedOperations: ["PUT", "GET", "HEAD", "metadata", "content-type", "digest"],
      digest: "sha256:artifact-store-proof",
      objectKey: "control-plane/proof",
    },
    ...overrides,
  };
}
