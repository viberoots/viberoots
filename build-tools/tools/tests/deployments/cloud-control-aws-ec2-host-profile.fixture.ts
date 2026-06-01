import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import {
  IMAGE_BUILD_IDENTITY,
  IMAGE_DIGEST,
  IMAGE_REF,
  privateLinkAwsTopology,
} from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

export function ec2HostProfileInput(
  overrides: Partial<CloudControlSetupInput> = {},
): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: IMAGE_REF,
    expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
    imagePublication: {
      image: IMAGE_REF,
      sourceRevision: "source-ec2-host",
      imageBuildIdentity: IMAGE_BUILD_IDENTITY,
      digest: IMAGE_DIGEST,
      inspectedDigest: IMAGE_DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-ec2-host",
      evidenceSource: "generated-command",
      registryProfile: ecrRegistryProfileForImage(IMAGE_REF, IMAGE_DIGEST),
    },
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: privateLinkAwsTopology(),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
    ...overrides,
  };
}
