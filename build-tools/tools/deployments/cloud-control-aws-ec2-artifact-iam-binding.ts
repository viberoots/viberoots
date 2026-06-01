import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { setupArtifactCredentialMode } from "./cloud-control-setup-aws-topology";

export function awsEc2ArtifactIamBindingField(input: CloudControlSetupInput) {
  return setupArtifactCredentialMode(input) === "aws-instance-profile"
    ? { instanceProfileBinding: awsEc2ArtifactIamBinding(input) }
    : {};
}

function awsEc2ArtifactIamBinding(input: CloudControlSetupInput) {
  const foundation = (input.awsTopology as any)?.foundation;
  const instanceProfileArn = String((input.awsTopology as any)?.compute?.instanceProfileArn || "");
  const profile = reviewedInstanceProfile(foundation, instanceProfileArn);
  return {
    instanceProfileArn,
    roleArn: profile?.roleArn || input.artifactIamRoleArn,
    expectedRoleArn: input.artifactIamRoleArn,
    trustDigest: profile?.trustDigest || foundation?.iam?.instanceProfileTrustDigest,
    policyDigests: profile?.policyDigests || [],
    leastPrivilegePolicyDigest: input.artifactLeastPrivilegePolicyDigest,
  };
}

function reviewedInstanceProfile(foundation: any, arn: string) {
  const profiles = Array.isArray(foundation?.iam?.instanceProfiles)
    ? foundation.iam.instanceProfiles
    : [];
  const profile = profiles.find((item: any) => item?.arn === arn);
  if (!profile) return undefined;
  return {
    roleArn: String(profile.roleArn || "").trim(),
    trustDigest: String(profile.trustDigest || "").trim(),
    policyDigests: Array.isArray(profile.policyDigests)
      ? profile.policyDigests.map((digest: unknown) => String(digest).trim()).filter(Boolean)
      : [],
  };
}
