import type { CutoverEvidence, CutoverValidationOptions } from "./cloud-control-cutover-types";
import type { ManagedDependencyValidationExpectations } from "./control-plane-managed-dependency-types";

const MISSING_REVIEWED_INSTANCE_PROFILE_ROLE =
  "cutover topology missing reviewed runtime instance-profile artifact IAM binding";
const MISSING_REVIEWED_ARTIFACT_POLICY =
  "cutover topology missing reviewed runtime least-privilege artifact policy binding";

export function managedDependencyExpectations(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): ManagedDependencyValidationExpectations {
  const topology = (evidence.awsTopology || {}) as any;
  const privatelink =
    topology.database?.mode === "privatelink" ? topology.database.privatelink || {} : {};
  const s3Endpoint = topology.s3VpcEndpoint || {};
  const alternate = topology.artifactBackendEvidence || {};
  const artifactIam = artifactIamExpectations(topology);
  const profile =
    evidence.managedDependencies?.supabasePostgres?.profile ||
    (evidence.providerCapabilities?.["supabase-managed-postgres"] as any)?.providerPayload
      ?.lifecycleEvidence?.profile ||
    evidence.supabasePostgresProfile;
  const profileProject = profile?.project || {};
  const profileConnection = profile?.connection || {};
  return {
    expectationErrors: artifactIam.errors,
    expectedHostProfile: options.expectedHostProfile,
    expectedRegion: options.expectedRegion,
    expectedDatabaseConnectivityMode: profileConnection.mode || topology.database?.mode,
    expectedSupabaseProjectRef: profile?.provisioning?.projectRef || privatelink.supabaseProjectRef,
    expectedSupabaseRegion: profileProject.region || privatelink.supabaseRegion,
    expectedPrivateLinkEndpointId: privatelink.endpointId,
    expectedPrivateLinkResourceId: privatelink.resourceConfigurationArn,
    expectedS3VpcEndpointId: s3Endpoint.endpointId,
    expectedS3EndpointPolicyDigest: s3Endpoint.endpointPolicyDigest,
    expectedArtifactIamRoleArn: artifactIam.roleArn,
    expectedArtifactLeastPrivilegePolicyDigest: artifactIam.policyDigest,
    expectedAlternateBackendEvidenceRef: alternate.reviewedReference,
    expectedAlternateBackendEvidenceDigest: alternate.digest,
    supabasePostgres: profile,
  };
}

function artifactIamExpectations(topology: any): {
  roleArn?: string;
  policyDigest?: string;
  errors: string[];
} {
  const foundation = topology.foundation || {};
  const computeProfileArn = String(topology.compute?.instanceProfileArn || "").trim();
  const profiles = Array.isArray(foundation.iam?.instanceProfiles)
    ? foundation.iam.instanceProfiles
    : [];
  const profile = profiles.find((item: any) => item?.arn === computeProfileArn);
  const roleArn = String(profile?.roleArn || "").trim();
  const policyDigest = artifactPolicyDigest(foundation, profile);
  return {
    roleArn: roleArn || undefined,
    policyDigest,
    errors: [
      ...(roleArn ? [] : [MISSING_REVIEWED_INSTANCE_PROFILE_ROLE]),
      ...(policyDigest ? [] : [MISSING_REVIEWED_ARTIFACT_POLICY]),
    ],
  };
}

function artifactPolicyDigest(foundation: any, profile: any): string | undefined {
  const profileDigests = Array.isArray(profile?.policyDigests) ? profile.policyDigests : [];
  const policies = Array.isArray(foundation.iam?.policies) ? foundation.iam.policies : [];
  const policy = policies.find(
    (item: any) =>
      profileDigests.includes(item?.digest) &&
      item?.leastPrivilege === true &&
      JSON.stringify(item?.actions || []).includes("s3:"),
  );
  return String(policy?.digest || "").trim() || undefined;
}
