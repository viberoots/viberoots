import type {
  ControlPlaneManagedDependencyProfile,
  ManagedDependencyValidationExpectations,
} from "./control-plane-managed-dependency-types";

export function expectationsFromProfile(
  profile: ControlPlaneManagedDependencyProfile,
): ManagedDependencyValidationExpectations {
  const runtime = profile.runtimePath;
  return {
    expectedHostProfile: runtime.expectedHostProfile,
    expectedRegion: runtime.expectedAwsRegion,
    expectedDatabaseConnectivityMode: runtime.databaseConnectivityMode,
    expectedSupabaseProjectRef: runtime.expectedSupabaseProjectRef,
    expectedSupabaseRegion: runtime.expectedSupabaseRegion,
    expectedPrivateLinkEndpointId: runtime.expectedPrivateLinkEndpointId,
    expectedPrivateLinkResourceId: runtime.expectedPrivateLinkResourceId,
    expectedS3VpcEndpointId: runtime.expectedS3VpcEndpointId,
    expectedS3EndpointPolicyDigest: runtime.expectedS3EndpointPolicyDigest,
    expectedArtifactIamRoleArn: runtime.expectedArtifactIamRoleArn,
    expectedArtifactLeastPrivilegePolicyDigest: runtime.expectedArtifactLeastPrivilegePolicyDigest,
    expectedAlternateBackendEvidenceRef: runtime.expectedAlternateBackendEvidenceRef,
    expectedAlternateBackendEvidenceDigest: runtime.expectedAlternateBackendEvidenceDigest,
    supabasePostgres: profile.supabasePostgres,
  };
}
