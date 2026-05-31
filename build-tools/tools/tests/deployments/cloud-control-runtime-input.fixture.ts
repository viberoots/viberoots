#!/usr/bin/env zx-wrapper
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { defaultReviewedRuntimeInput } from "../../deployments/cloud-control-runtime-input";
import type { RuntimeInput } from "../../deployments/cloud-control-runtime-input";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

const DIGEST_REF =
  "registry.example.com/platform/deployment-control-plane@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST = `sha256:${"a".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"b".repeat(64)}`;

export function reviewedRuntimeInput(
  opts: { artifactCredentialMode?: string; deploymentIds?: string[]; publicUrl?: string } = {},
) {
  return defaultReviewedRuntimeInput({
    publicUrl: opts.publicUrl || "https://deploy.example.test",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    deploymentIds: opts.deploymentIds || ["pleomino-staging"],
    supabaseProjectRef: "project-review",
    supabaseConnectionMode: "privatelink",
    awsAccountId: "123456789012",
    awsRegion: "us-east-1",
    awsVpcId: "vpc-123",
    artifactCredentialMode: opts.artifactCredentialMode || "files",
  });
}

export function reviewedRuntimeInputYaml(): string {
  const input = reviewedRuntimeInput();
  return [
    "schemaVersion: cloud-control-runtime-input@1",
    "mode: production",
    `provenance: ${JSON.stringify(input.provenance)}`,
    `authProvider: ${JSON.stringify(input.authProvider)}`,
    "infisicalDeployments:",
    "  - deploymentId: pleomino-staging",
    "    siteUrl: https://app.infisical.com",
    "    projectId: infisical-prod-project",
    "    environment: production",
    "    evidenceRef: evidence://infisical/project",
    "",
  ].join("\n");
}

export function runtimeInputProfile(
  overrides: Partial<RuntimeInput["authProvider"]> = {},
): RuntimeInput {
  const base = reviewedRuntimeInput();
  return {
    ...base,
    authProvider: {
      ...base.authProvider,
      provider: "external-oidc",
      issuer: "https://auth.prod.example.com",
      jwksUrl: "https://auth.prod.example.com/.well-known/jwks.json",
      callback: {
        ...base.authProvider.callback,
        registrationEvidenceRef: "evidence://auth/callback",
      },
      metadata: {
        ...base.authProvider.metadata,
        environment: "production",
        evidenceDigest: "sha256:auth-profile",
      },
      ...overrides,
    },
    infisicalDeployments: [
      {
        deploymentId: "pleomino-staging",
        siteUrl: "https://app.infisical.com",
        projectId: "infisical-prod-project",
        environment: "production",
        evidenceRef: "evidence://infisical/project",
      },
    ],
  };
}

export function runtimeSetupInput(
  overrides: Partial<CloudControlSetupInput> = {},
): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: DIGEST_REF,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: DIGEST_REF,
      sourceRevision: "source-runtime-input",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-runtime-input",
      evidenceSource: "generated-command",
      registryProfile: ecrRegistryProfileForImage(DIGEST_REF, DIGEST),
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
    awsTopology: topologyForPublishedImage(privateLinkAwsTopology(), DIGEST_REF, DIGEST),
    supabasePostgres: privateLinkSupabaseProfile(),
    ...overrides,
  };
}
