import type { ControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";
import type { AwsTopologyEvidence } from "./cloud-control-aws-topology-types";

export const CLOUD_PROFILE_MODES = ["compose-podman", "nixos", "saas-oci", "aws-ec2"] as const;

export const REVIEWED_SOURCE_MODES = ["ssh", "github-app"] as const;

export const ARTIFACT_BACKENDS = ["aws-s3", "supabase-storage-s3", "s3-compatible"] as const;

export type CloudProfileMode = (typeof CLOUD_PROFILE_MODES)[number];
export type ReviewedSourceMode = (typeof REVIEWED_SOURCE_MODES)[number];
export type ArtifactBackend = (typeof ARTIFACT_BACKENDS)[number];

export type CloudControlSetupInput = {
  outDir: string;
  mode: CloudProfileMode;
  image: string;
  expectedImageBuildIdentity: string;
  imagePublication?: ControlPlaneImagePublicationEvidence;
  imagePublicationEvidencePath?: string;
  instanceId: string;
  publicUrl: string;
  artifactBucket: string;
  artifactRegion: string;
  artifactBackend: ArtifactBackend;
  artifactBackendEvidence: string;
  deploymentIds: string[];
  reviewedSourceMode: ReviewedSourceMode;
  authCallbackHost: string;
  authCallbackPath: string;
  serviceReplicas: number;
  workerReplicas: number;
  dryRun: boolean;
  awsTopology?: AwsTopologyEvidence;
};

export type ProviderCapabilityDeclaration = {
  id: string;
  targetIdentity: string;
  credentialSource: string;
  lockScope: string;
  previewDiffBehavior: string;
  mutationSequence: string[];
  smokeChecks: string[];
  rollbackProcedure: string[];
  replaySemantics: string;
  auditEvidence: string[];
  protectedSharedEligibility: string;
  iac: {
    reviewedReference: string;
    previewCommand: string;
    applyCommand: string;
    smokeCommand: string;
    evidenceCommand: string;
    rollbackCommand: string;
  };
};
