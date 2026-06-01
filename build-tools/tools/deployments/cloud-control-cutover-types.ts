export const CUTOVER_OPERATIONS = ["cutover", "rollback", "restore", "break-glass"] as const;

export type CutoverOperation = (typeof CUTOVER_OPERATIONS)[number];

export type CutoverEvidence = {
  schemaVersion?: string;
  operationIdentity?: {
    operation?: CutoverOperation;
    sourceHost?: string;
    checkedAt?: string;
  };
  hostProfile: string;
  region?: string;
  generatedAt: string;
  checkedAt?: string;
  sourceHost?: string;
  imageDigest?: string;
  configDigest?: string;
  expectedImageBuildIdentity?: string;
  selectedProviderCapabilities?: string[];
  health?: Record<string, unknown>;
  expectedWorkerCount?: number;
  imagePublication?: ControlPlaneImagePublicationEvidence;
  managedDependencies?: ManagedDependencyEvidence;
  supabasePostgresProfile?: SupabaseManagedPostgresProfile;
  awsTopology?: Record<string, unknown>;
  ingressCommandEvidence?: Record<string, unknown>;
  latestNonProductionDeployment?: Record<string, unknown>;
  providerCapabilities?: Record<string, Record<string, unknown>>;
  credentialManifestDigest?: string;
  credentialMapDigest?: string;
  credentialMap?: Record<string, unknown>;
  credentialManifestRequiredFiles?: string[];
  credentialStaging?: CredentialStagingEvidence;
  credentialRotation?: CredentialRotationEvidence;
  runtimeConfig?: Record<string, unknown>;
  standby?: Record<string, unknown>;
  restore?: Record<string, unknown>;
  rollback?: Record<string, unknown>;
  breakGlass?: Record<string, unknown>;
  audit?: Record<string, unknown>;
};

export type CutoverValidationOptions = {
  expectedHostProfile: string;
  expectedImageBuildIdentity: string;
  expectedRegion?: string;
  operation: CutoverOperation;
  selectedCapabilities: string[];
  maxAgeMinutes: number;
};

export type CutoverValidationResult = {
  ok: boolean;
  errors: string[];
  checklist: string[];
};
import type { ControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";
import type { ManagedDependencyEvidence } from "./control-plane-managed-dependency-types";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";
import type {
  CredentialRotationEvidence,
  CredentialStagingEvidence,
} from "./control-plane-credential-staging-types";
