import type { CloudControlSetupInput } from "./cloud-control-setup-types";

export function validateSetupArtifactIamEvidence(input: CloudControlSetupInput): string[] {
  const errors: string[] = [];
  if (!input.artifactIamRoleArn) {
    errors.push("AWS S3 instance-profile mode requires IAM role ARN");
  }
  if (!input.artifactLeastPrivilegePolicyDigest) {
    errors.push("AWS S3 instance-profile mode requires least-privilege policy digest");
  }
  if (!String((input.awsTopology as any)?.compute?.instanceProfileArn || "").trim()) {
    errors.push("AWS S3 instance-profile mode requires compute instance profile evidence");
  }
  const foundation = (input.awsTopology as any)?.foundation;
  const reviewedRole = String(foundation?.iam?.roles?.s3ArtifactAccess || "").trim();
  const computeProfileArn = String((input.awsTopology as any)?.compute?.instanceProfileArn || "");
  if (!reviewedRole) {
    errors.push("AWS S3 instance-profile mode requires reviewed artifact IAM role evidence");
  } else if (input.artifactIamRoleArn && reviewedRole !== input.artifactIamRoleArn) {
    errors.push("AWS S3 artifact IAM role does not match reviewed foundation role evidence");
  }
  const profile = reviewedInstanceProfile(foundation, computeProfileArn);
  if (!profile) {
    errors.push("AWS S3 instance-profile mode requires reviewed profile-to-role evidence");
  } else {
    if (input.artifactIamRoleArn && profile.roleArn !== input.artifactIamRoleArn) {
      errors.push("AWS S3 instance profile role does not match expected artifact role");
    }
    if (profile.trustDigest !== String(foundation?.iam?.instanceProfileTrustDigest || "")) {
      errors.push("AWS S3 instance profile trust evidence does not match reviewed trust digest");
    }
    if (
      input.artifactLeastPrivilegePolicyDigest &&
      !profile.policyDigests.includes(input.artifactLeastPrivilegePolicyDigest)
    ) {
      errors.push("AWS S3 instance profile policy does not include expected artifact policy");
    }
  }
  const policies = Array.isArray(foundation?.iam?.policies) ? foundation.iam.policies : [];
  const policy = policies.find(
    (item: any) => item?.digest === input.artifactLeastPrivilegePolicyDigest,
  );
  if (input.artifactLeastPrivilegePolicyDigest && !policy?.leastPrivilege) {
    errors.push("AWS S3 artifact policy digest must reference reviewed least-privilege evidence");
  }
  return errors;
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
