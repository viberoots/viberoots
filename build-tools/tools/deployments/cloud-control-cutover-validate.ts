import {
  type CutoverEvidence,
  type CutoverValidationOptions,
  type CutoverValidationResult,
} from "./cloud-control-cutover-types";
import {
  requiredAwsProviderCapabilities,
  validateAwsCutoverTopology,
} from "./cloud-control-cutover-aws";
import { validateCutoverProviderCapabilities } from "./cloud-control-cutover-provider-capabilities";
import { validateControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";
import { validateManagedDependencyEvidence } from "./control-plane-managed-dependency-validation";
import type { ManagedDependencyValidationExpectations } from "./control-plane-managed-dependency-types";
import { validateSupabaseProfileSource } from "./cloud-control-cutover-supabase";
import { validateCredentialCutoverEvidence } from "./cloud-control-cutover-credentials";
import { validateCutoverOperationEvidence } from "./cloud-control-cutover-operation";
import { validateCutoverEvidenceContract } from "./cloud-control-cutover-contract";
import { validateRuntimeHttpEvidenceSet } from "./cloud-control-runtime-http-evidence";

const BASE_HEALTH = [
  "cloudHealth",
  "readiness",
  "workerHeartbeats",
  "databaseConnectivity",
  "artifactStoreCompatibility",
  "authCallbackReachability",
  "uiReads",
  "mcpReads",
];

export function validateCloudControlCutover(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): CutoverValidationResult {
  const errors = [
    ...validateCutoverEvidenceContract(evidence, options),
    ...validateIdentity(evidence, options),
    ...validateRuntimeConfigContract(evidence),
    ...validateBaseHealth(evidence),
    ...validateRuntimeHttpEvidenceSet(evidence.health, {
      expectedPublicUrl: String(evidence.runtimeConfig?.publicUrl || ""),
      expectedHostProfile: options.expectedHostProfile,
      expectedProfileIdentity: String(evidence.sourceHost || ""),
      expectedDeploymentIds: expectedDeploymentIds(evidence),
      expectedWorkerCount: expectedWorkerCount(evidence),
      maxAgeMinutes: options.maxAgeMinutes,
    }),
    ...validateSupabaseProfileSource(evidence, options),
    ...validateManagedDependencyCutoverSource(evidence),
    ...validateManagedDependencyEvidence(
      evidence.managedDependencies,
      options.maxAgeMinutes,
      managedDependencyExpectations(evidence, options),
    ),
    ...validateCredentialCutoverEvidence(evidence, options),
    ...validateImagePublication(evidence, options),
    ...validateLatestDeployment(evidence, options),
    ...validateCutoverProviderCapabilities(
      evidence,
      requiredProviderCapabilities(evidence, options),
      options.maxAgeMinutes,
    ),
    ...validateAwsCutoverTopology(evidence, options),
    ...validateCutoverOperationEvidence(evidence, options.operation),
    ...validateAudit(evidence, options.operation),
  ];
  return { ok: errors.length === 0, errors, checklist: checklist(options) };
}

function validateManagedDependencyCutoverSource(evidence: CutoverEvidence): string[] {
  const runtime = (evidence.managedDependencies?.runtimePath || {}) as Record<string, unknown>;
  if (runtime.databaseConnectivityMode === "privatelink" && runtime.nonCutoverDiagnostic === true) {
    return ["PrivateLink cutover cannot use diagnostic-only managed dependency evidence"];
  }
  return [];
}

function managedDependencyExpectations(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): ManagedDependencyValidationExpectations {
  const topology = (evidence.awsTopology || {}) as any;
  const privatelink =
    topology.database?.mode === "privatelink" ? topology.database.privatelink || {} : {};
  const s3Endpoint = topology.s3VpcEndpoint || {};
  const alternate = topology.artifactBackendEvidence || {};
  const profile =
    evidence.managedDependencies?.supabasePostgres?.profile ||
    (evidence.providerCapabilities?.["supabase-managed-postgres"] as any)?.providerPayload
      ?.lifecycleEvidence?.profile ||
    evidence.supabasePostgresProfile;
  const profileProject = profile?.project || {};
  const profileConnection = profile?.connection || {};
  return {
    expectedHostProfile: options.expectedHostProfile,
    expectedRegion: options.expectedRegion,
    expectedDatabaseConnectivityMode: profileConnection.mode || topology.database?.mode,
    expectedSupabaseProjectRef: profile?.provisioning?.projectRef || privatelink.supabaseProjectRef,
    expectedSupabaseRegion: profileProject.region || privatelink.supabaseRegion,
    expectedPrivateLinkEndpointId: privatelink.endpointId,
    expectedPrivateLinkResourceId: privatelink.resourceConfigurationArn,
    expectedS3VpcEndpointId: s3Endpoint.endpointId,
    expectedS3EndpointPolicyDigest: s3Endpoint.endpointPolicyDigest,
    expectedAlternateBackendEvidenceRef: alternate.reviewedReference,
    expectedAlternateBackendEvidenceDigest: alternate.digest,
    supabasePostgres: profile,
  };
}

function validateImagePublication(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  const image = String(evidence.latestNonProductionDeployment?.image || "");
  const errors = [
    ...(image ? [] : ["missing latest non-production image digest evidence"]),
    ...(options.expectedImageBuildIdentity
      ? []
      : ["cutover validation requires expected image build identity"]),
  ];
  return [
    ...errors,
    ...validateControlPlaneImagePublicationEvidence(
      evidence.imagePublication,
      image,
      options.expectedImageBuildIdentity,
      {
        requireRegistryProfile: options.expectedHostProfile === "aws-ec2",
        expectedRuntimeHostProfile: options.expectedHostProfile,
      },
    ),
  ];
}

function requiredProviderCapabilities(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  return unique([
    ...options.selectedCapabilities,
    ...requiredAwsProviderCapabilities(evidence, options),
  ]);
}

function validateIdentity(evidence: CutoverEvidence, options: CutoverValidationOptions): string[] {
  const errors: string[] = [];
  if (evidence.hostProfile !== options.expectedHostProfile) {
    errors.push(`evidence host profile ${evidence.hostProfile || "<missing>"} does not match`);
  }
  if (options.expectedRegion && evidence.region !== options.expectedRegion) {
    errors.push(`evidence region ${evidence.region || "<missing>"} does not match`);
  }
  const generatedAt = Date.parse(evidence.generatedAt || "");
  if (!Number.isFinite(generatedAt)) errors.push("evidence generatedAt is missing or invalid");
  const ageMs = Date.now() - generatedAt;
  if (Number.isFinite(generatedAt) && ageMs > options.maxAgeMinutes * 60_000) {
    errors.push("evidence is stale");
  }
  return errors;
}

function validateBaseHealth(evidence: CutoverEvidence): string[] {
  return BASE_HEALTH.flatMap((name) =>
    evidence.health?.[name] ? [] : [`missing ${name} evidence`],
  );
}

function validateRuntimeConfigContract(evidence: CutoverEvidence): string[] {
  return [
    ...(expectedDeploymentIds(evidence).length > 0
      ? []
      : ["runtime config missing trusted deployment ids"]),
    ...(expectedWorkerCount(evidence) > 0
      ? []
      : ["runtime config missing trusted expected worker count"]),
  ];
}

function expectedWorkerCount(evidence: CutoverEvidence): number {
  const count = Number((evidence.runtimeConfig?.workers as any)?.expectedCount);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function expectedDeploymentIds(evidence: CutoverEvidence): string[] {
  const deploymentIds = evidence.runtimeConfig?.deploymentIds;
  return Array.isArray(deploymentIds) ? deploymentIds.map(String).filter(Boolean) : [];
}

function validateLatestDeployment(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  const latest = evidence.latestNonProductionDeployment || {};
  const errors: string[] = [];
  if (!latest.runId) errors.push("missing latest non-production deployment evidence");
  if (latest.hostProfile !== options.expectedHostProfile) {
    errors.push("latest non-production deployment evidence is from the wrong host profile");
  }
  if (latest.trafficIngressHostProfile !== options.expectedHostProfile) {
    errors.push("latest non-production traffic/ingress is not pointed at the cloud host profile");
  }
  if (latest.cloudPrimaryPath !== true) {
    errors.push("latest non-production deployment did not run through the cloud-primary path");
  }
  if (latest.stagingDeploymentSucceeded !== true) {
    errors.push("latest protected/shared staging deployment did not succeed through cloud-primary");
  }
  return errors;
}

function validateAudit(evidence: CutoverEvidence, operation: string): string[] {
  const audit = evidence.audit || {};
  return audit[operation] ? [] : [`missing ${operation} audit evidence`];
}

function checklist(options: CutoverValidationOptions): string[] {
  return [
    `validate ${options.expectedHostProfile} health/readiness and auth callback reachability`,
    "confirm UI and MCP reads use the cloud-primary endpoint",
    "confirm standby workers cannot double-execute submissions",
    `confirm ${options.operation} audit evidence is recorded`,
  ];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
