#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { defaultReviewedRuntimeInput } from "../../deployments/cloud-control-runtime-input";
import {
  privateLinkAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-aws-topology.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

export const IMAGE =
  "registry.example.com/platform/deployment-control-plane@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const DIGEST = `sha256:${"e".repeat(64)}`;
export const BUILD_IDENTITY = `nix-source-${"f".repeat(64)}`;

export async function writeBundle(dir: string, setupInput = input()): Promise<void> {
  const bundle = renderCloudControlSetupBundle({ ...setupInput, outDir: dir });
  for (const [name, content] of Object.entries(bundle.files)) {
    const filePath = path.join(dir, name);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, "utf8");
  }
}

export async function withRawControlPlaneArgv<T>(
  argv: string[],
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.argv;
  const previousGlobal = (globalThis as any).argv;
  process.argv = ["node", "deployment-control-plane.ts", ...argv];
  (globalThis as any).argv = undefined;
  try {
    return await run();
  } finally {
    process.argv = previous;
    (globalThis as any).argv = previousGlobal;
  }
}

export function cutoverOptions() {
  return {
    operation: "cutover" as const,
    expectedHostProfile: "aws-ec2",
    expectedImageBuildIdentity: BUILD_IDENTITY,
    expectedRegion: "us-east-1",
    selectedCapabilities: [],
    maxAgeMinutes: 1440,
  };
}

function input(): CloudControlSetupInput {
  return {
    outDir: "unused",
    mode: "aws-ec2",
    image: IMAGE,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: IMAGE,
      sourceRevision: "source-review",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: DIGEST,
      inspectedDigest: DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-review",
      evidenceSource: "generated-command",
      registryProfile: ecrRegistryProfileForImage(IMAGE, DIGEST),
    },
    instanceId: "cloud-review",
    publicUrl: "https://deploy.example.test",
    artifactBucket: "deployment-control-plane-artifacts",
    artifactRegion: "us-east-1",
    artifactBackend: "aws-s3",
    artifactCredentialMode: "aws-instance-profile",
    artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
    artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    runtimeInput: defaultReviewedRuntimeInput({
      publicUrl: "https://deploy.example.test",
      authCallbackHost: "deploy-auth.example.test",
      authCallbackPath: "/oidc/callback",
      deploymentIds: ["pleomino-staging"],
      supabaseProjectRef: "project-review",
      supabaseConnectionMode: "privatelink",
      awsAccountId: "123456789012",
      awsRegion: "us-east-1",
      awsVpcId: "vpc-123",
      artifactCredentialMode: "aws-instance-profile",
    }),
    supabasePostgres: privateLinkSupabaseProfile(),
    awsTopology: topologyForPublishedImage(privateLinkAwsTopology(), IMAGE, DIGEST),
  };
}
