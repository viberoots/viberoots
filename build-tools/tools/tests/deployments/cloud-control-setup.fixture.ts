import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { privateLinkAwsTopology } from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";

export const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST = `sha256:${"a".repeat(64)}`;
export const BUILD_IDENTITY = `nix-source-${"b".repeat(64)}`;

export function baseInput(overrides: Partial<CloudControlSetupInput> = {}): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "compose-podman",
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: publicationEvidence(DIGEST_REF, DIGEST),
    instanceId: "cloud-staging",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactBackendEvidence: "",
    deploymentIds: ["sample-webapp-staging"],
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

function publicationEvidence(image: string, digest: string) {
  return {
    image,
    sourceRevision: "source-abc123",
    imageBuildIdentity: BUILD_IDENTITY,
    digest,
    inspectedDigest: digest,
    tag: "registry.example.com/platform/deployment-control-plane:source-abc123",
    evidenceSource: "generated-command" as const,
    registryProfile: ecrRegistryProfileForImage(image, digest),
  };
}
