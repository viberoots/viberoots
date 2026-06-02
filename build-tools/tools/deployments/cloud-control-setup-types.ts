import type { ControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";
import type { AwsTopologyEvidence } from "./cloud-control-aws-topology-types";
import type { ArtifactCredentialMode } from "./control-plane-artifact-credential-mode";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";
import type { RuntimeInput } from "./cloud-control-runtime-input";
import type { Ec2HostMode } from "./cloud-control-aws-ec2-host-mode";

export const CLOUD_PROFILE_MODES = ["compose-podman", "nixos", "saas-oci", "aws-ec2"] as const;

export const REVIEWED_SOURCE_MODES = ["ssh", "github-app"] as const;

export const ARTIFACT_BACKENDS = [
  "aws-s3",
  "supabase-storage-s3",
  "cloudflare-r2",
  "s3-compatible",
] as const;

export const EC2_ASG_EVIDENCE_MODES = ["pre-apply", "post-apply"] as const;

export type CloudProfileMode = (typeof CLOUD_PROFILE_MODES)[number];
export type ReviewedSourceMode = (typeof REVIEWED_SOURCE_MODES)[number];
export type ArtifactBackend = (typeof ARTIFACT_BACKENDS)[number];
export type Ec2AsgEvidenceMode = (typeof EC2_ASG_EVIDENCE_MODES)[number];

export type CloudControlSetupInput = {
  outDir: string;
  mode: CloudProfileMode;
  ec2HostMode?: Ec2HostMode;
  image: string;
  expectedImageBuildIdentity: string;
  imagePublication?: ControlPlaneImagePublicationEvidence;
  imagePublicationEvidencePath?: string;
  instanceId: string;
  publicUrl: string;
  artifactBucket: string;
  artifactRegion: string;
  artifactBackend: ArtifactBackend;
  artifactCredentialMode?: ArtifactCredentialMode;
  artifactBackendEvidence: string;
  artifactIamRoleArn?: string;
  artifactLeastPrivilegePolicyDigest?: string;
  deploymentIds: string[];
  reviewedSourceMode: ReviewedSourceMode;
  authCallbackHost: string;
  authCallbackPath: string;
  serviceReplicas: number;
  workerReplicas: number;
  dryRun: boolean;
  ec2AsgEvidenceMode?: Ec2AsgEvidenceMode;
  awsTopology?: AwsTopologyEvidence;
  supabasePostgres?: SupabaseManagedPostgresProfile;
  runtimeInput?: RuntimeInput;
  supabasePrivatelink?: boolean;
  ingressCommandEvidence?: Record<string, unknown>;
  requireIngressCommandEvidence?: boolean;
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
