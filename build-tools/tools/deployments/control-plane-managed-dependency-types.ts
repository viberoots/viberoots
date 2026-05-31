#!/usr/bin/env zx-wrapper
import type {
  SupabaseManagedPostgresEvidence,
  SupabaseManagedPostgresProfile,
} from "./control-plane-supabase-postgres-profile";

export type ManagedPostgresProvider = "supabase-postgres" | "postgres-compatible";

export type ManagedArtifactStoreProvider =
  | "aws-s3"
  | "supabase-storage-s3"
  | "cloudflare-r2"
  | "s3-compatible";

export type ManagedDatabaseConnectivityMode = "public" | "privatelink";
export type ManagedRuntimeSourceHostKind = "aws-ec2" | "diagnostic" | "unknown";

export type ManagedRuntimePathFacts = {
  hostProfile?: string;
  awsRegion?: string;
  sourceHostIdentity?: string;
  sourceHostKind?: ManagedRuntimeSourceHostKind;
  nonCutoverDiagnostic?: boolean;
  supabaseProjectRef?: string;
  supabaseRegion?: string;
  privatelinkEndpointId?: string;
  privatelinkResourceId?: string;
  s3VpcEndpointId?: string;
  s3EndpointPolicyDigest?: string;
  expectedArtifactIamRoleArn?: string;
  expectedArtifactLeastPrivilegePolicyDigest?: string;
  alternateBackendEvidenceRef?: string;
  alternateBackendEvidenceDigest?: string;
};

export type ManagedDependencyValidationExpectations = {
  expectedHostProfile?: string;
  expectedRegion?: string;
  expectedDatabaseConnectivityMode?: ManagedDatabaseConnectivityMode;
  expectedSupabaseProjectRef?: string;
  expectedSupabaseRegion?: string;
  expectedPrivateLinkEndpointId?: string;
  expectedPrivateLinkResourceId?: string;
  expectedS3VpcEndpointId?: string;
  expectedS3EndpointPolicyDigest?: string;
  expectedArtifactIamRoleArn?: string;
  expectedArtifactLeastPrivilegePolicyDigest?: string;
  expectedAlternateBackendEvidenceRef?: string;
  expectedAlternateBackendEvidenceDigest?: string;
  supabasePostgres?: SupabaseManagedPostgresProfile;
};

export type ManagedPostgresProfile = {
  provider: ManagedPostgresProvider;
  urlFile: string;
};

export type ManagedArtifactStoreProfile = {
  provider: ManagedArtifactStoreProvider;
  credentialMode: "files" | "aws-instance-profile";
  bucket: string;
  region: string;
  endpointFile: string;
  accessKeyIdFile?: string;
  secretAccessKeyFile?: string;
  keyPrefix?: string;
};

export type ManagedRuntimePathExpectations = {
  expectedHostProfile: string;
  expectedAwsRegion: string;
  databaseConnectivityMode: ManagedDatabaseConnectivityMode;
  expectedSupabaseProjectRef?: string;
  expectedSupabaseRegion?: string;
  expectedPrivateLinkEndpointId?: string;
  expectedPrivateLinkResourceId?: string;
  expectedS3VpcEndpointId?: string;
  expectedS3EndpointPolicyDigest?: string;
  expectedArtifactIamRoleArn?: string;
  expectedArtifactLeastPrivilegePolicyDigest?: string;
  expectedAlternateBackendEvidenceRef?: string;
  expectedAlternateBackendEvidenceDigest?: string;
  nonCutoverDiagnostic?: boolean;
};

export type ControlPlaneManagedDependencyProfile = {
  profileName: string;
  compatibilityEvidenceFile?: string;
  supabasePostgres?: SupabaseManagedPostgresProfile;
  runtimePath: ManagedRuntimePathExpectations;
  postgres: ManagedPostgresProfile;
  artifactStore: ManagedArtifactStoreProfile;
};

export type ManagedRuntimePathEvidence = {
  hostProfile?: string;
  awsRegion?: string;
  databaseConnectivityMode: ManagedDatabaseConnectivityMode;
  sourceHostIdentity?: string;
  sourceHostKind?: ManagedRuntimeSourceHostKind;
  nonCutoverDiagnostic?: boolean;
  supabaseProjectRef?: string;
  supabaseRegion?: string;
  privatelinkEndpointId?: string;
  privatelinkResourceId?: string;
  s3VpcEndpointId?: string;
  s3EndpointPolicyDigest?: string;
  artifactIamRoleArn?: string;
  artifactLeastPrivilegePolicyDigest?: string;
  alternateBackendEvidenceRef?: string;
  alternateBackendEvidenceDigest?: string;
};

export type ManagedDependencyEvidence = {
  schemaVersion: "control-plane-managed-dependency-evidence@1";
  profileName: string;
  checkedAt: string;
  supabasePostgres?: SupabaseManagedPostgresEvidence;
  runtimePath: ManagedRuntimePathEvidence;
  postgres: {
    provider: ManagedPostgresProvider;
    serverVersionNum: number;
    checkedFeatures: string[];
    resolvedHost: string;
    tlsEnabled: boolean;
    peerHostIdentity?: string;
    databaseConnectivityMode: ManagedDatabaseConnectivityMode;
    sourceHostIdentity?: string;
    sourceHostKind?: ManagedRuntimeSourceHostKind;
    supabaseProjectRef?: string;
    supabaseRegion?: string;
    privatelinkEndpointId?: string;
    privatelinkResourceId?: string;
  };
  artifactStore: {
    provider: ManagedArtifactStoreProvider;
    bucket: string;
    region: string;
    endpointHost: string;
    keyPrefix?: string;
    sourceHostIdentity?: string;
    sourceHostKind?: ManagedRuntimeSourceHostKind;
    s3VpcEndpointId?: string;
    s3EndpointPolicyDigest?: string;
    artifactCredentialMode?: "files" | "aws-instance-profile";
    expectedArtifactIamRoleArn?: string;
    observedArtifactIamRoleName?: string;
    artifactLeastPrivilegePolicyDigest?: string;
    alternateBackendEvidenceRef?: string;
    alternateBackendEvidenceDigest?: string;
    checkedOperations: string[];
    digest: string;
    objectKey: string;
  };
};
