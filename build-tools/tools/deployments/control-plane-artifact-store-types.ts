#!/usr/bin/env zx-wrapper

export type ControlPlaneArtifactObject = {
  storeKind: "s3-compatible";
  bucket: string;
  key: string;
  digest: string;
  size: number;
  contentType: string;
  provenance: {
    deploymentId?: string;
    submissionId?: string;
    artifactIdentity?: string;
    payloadKind: "artifact" | "execution-snapshot";
  };
};

export type ControlPlaneArtifactStore = {
  kind: "s3-compatible";
  bucket: string;
  putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<void>;
  getObject(input: { key: string }): Promise<Buffer>;
  getObjectMetadata(input: {
    key: string;
  }): Promise<{ contentType?: string; metadata: Record<string, string> }>;
};

export type ControlPlaneArtifactStoreConfig = {
  provider: ArtifactBackend;
  credentialMode: ArtifactCredentialMode;
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  credentialProvider?: AwsCredentialProvider;
  keyPrefix?: string;
};
import type { AwsCredentialProvider } from "./control-plane-aws-imds-credentials";
import type { ArtifactBackend } from "./cloud-control-setup-types";
import type { ArtifactCredentialMode } from "./control-plane-artifact-credential-mode";
