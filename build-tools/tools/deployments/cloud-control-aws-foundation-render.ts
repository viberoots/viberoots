import type { AwsArtifactBackend } from "./cloud-control-aws-topology-types";
import {
  AWS_FOUNDATION_PROFILE_SCHEMA,
  type AwsFoundationProfile,
} from "./cloud-control-aws-foundation-types";

export type AwsFoundationInspection = Omit<AwsFoundationProfile, "schemaVersion" | "checkedAt"> & {
  checkedAt?: string;
};

export function awsFoundationProfileFromInspection(
  inspection: AwsFoundationInspection,
): AwsFoundationProfile {
  return {
    schemaVersion: AWS_FOUNDATION_PROFILE_SCHEMA,
    checkedAt: inspection.checkedAt || new Date().toISOString(),
    source: inspection.source,
    capabilityIds: [...inspection.capabilityIds],
    accountId: inspection.accountId,
    partition: inspection.partition,
    region: inspection.region,
    state: inspection.state,
    tags: inspection.tags,
    preflight: inspection.preflight,
    network: inspection.network,
    iam: inspection.iam,
    artifactStore: inspection.artifactStore,
  };
}

export function foundationCapabilityIds(backend: AwsArtifactBackend): string[] {
  return ["aws-network-foundation", ...(backend === "aws-s3" ? ["aws-s3-artifact-store"] : [])];
}
