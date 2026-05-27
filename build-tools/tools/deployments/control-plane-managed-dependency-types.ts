#!/usr/bin/env zx-wrapper

export type ManagedPostgresProvider = "supabase-postgres" | "postgres-compatible";

export type ManagedArtifactStoreProvider =
  | "supabase-storage-s3"
  | "cloudflare-r2"
  | "s3-compatible";

export type ManagedPostgresProfile = {
  provider: ManagedPostgresProvider;
  urlFile: string;
};

export type ManagedArtifactStoreProfile = {
  provider: ManagedArtifactStoreProvider;
  bucket: string;
  region: string;
  endpointFile: string;
  accessKeyIdFile: string;
  secretAccessKeyFile: string;
  keyPrefix?: string;
};

export type ControlPlaneManagedDependencyProfile = {
  profileName: string;
  compatibilityEvidenceFile?: string;
  postgres: ManagedPostgresProfile;
  artifactStore: ManagedArtifactStoreProfile;
};

export type ManagedDependencyEvidence = {
  schemaVersion: "control-plane-managed-dependency-evidence@1";
  profileName: string;
  checkedAt: string;
  postgres: {
    provider: ManagedPostgresProvider;
    serverVersionNum: number;
    checkedFeatures: string[];
  };
  artifactStore: {
    provider: ManagedArtifactStoreProvider;
    bucket: string;
    region: string;
    endpointHost: string;
    checkedOperations: string[];
    digest: string;
    objectKey: string;
  };
};
