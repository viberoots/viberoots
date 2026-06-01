import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { defaultReviewedRuntimeInput } from "../../deployments/cloud-control-runtime-input";
import {
  privateLinkAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-aws-topology.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import { liveHostVerifierProfile as signedLiveHostVerifierProfile } from "./control-plane-credential-remote-verifier.fixture";

const IMAGE =
  "registry.example.com/platform/deployment-control-plane@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DIGEST = `sha256:${"e".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"f".repeat(64)}`;

export function input(): CloudControlSetupInput {
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
    artifactIamRoleArn: "arn:aws:iam::123456789012:role/control-plane-host",
    artifactLeastPrivilegePolicyDigest: "sha256:artifact-policy",
    supabasePostgres: privateLinkSupabaseProfile(),
    awsTopology: topologyForPublishedImage(privateLinkAwsTopology(), IMAGE, DIGEST),
  };
}

export async function writeLiveProfile(file: string, siteUrl: string, source: any): Promise<void> {
  await fsp.writeFile(
    file,
    JSON.stringify({
      schemaVersion: "control-plane-live-infisical-backend-profile@1",
      siteUrl,
      clientId: "writer",
      clientSecret: "writer-secret",
      projectId: source.selector.projectId,
      environment: source.selector.environment,
      secretPath: source.selector.secretPath,
      deploymentIdentityEvidenceRef: source.deploymentIdentityEvidenceRef,
      leastPrivilegeScopeEvidenceRef: source.leastPrivilegeScopeEvidenceRef,
      leastPrivilegeScope: source.leastPrivilegeScope,
    }),
  );
}

export async function writeCredentialFiles(bundle: string, dir: string): Promise<void> {
  const manifest = JSON.parse(
    await fsp.readFile(path.join(bundle, "credential-manifest.json"), "utf8"),
  );
  await fsp.mkdir(dir, { recursive: true });
  for (const name of manifest.requiredFiles) {
    const file = path.join(dir, name);
    await fsp.writeFile(file, "placeholder\n", { mode: 0o400 });
    await fsp.chmod(file, 0o400);
  }
}

export async function credentialOwner(dir: string): Promise<{ uid: number; gid: number }> {
  const stat = await fsp.stat(path.join(dir, "control-plane-token"));
  return { uid: stat.uid, gid: stat.gid };
}

export async function liveHostVerification(tmp: string) {
  const manifest = JSON.parse(
    await fsp.readFile(path.join(tmp, "credential-manifest.json"), "utf8"),
  );
  const evidence = {
    wiringMode: "bind-mounted-credential-directory",
    targetPath: "/run/deployment-control-plane/credentials",
    filenameSet: manifest.requiredFiles,
    owner: { uid: 10001, gid: 10001 },
    permissions: "0400",
    verifiedBy: "live-host-check",
    evidenceRef: "evidence://credential-staging/deployment-owned-live-host-verification",
    schemaVersion: "control-plane-live-host-verification@1",
    checkedAt: new Date().toISOString(),
    source: "deployment-owned-live-host-verification",
    verifier: "reviewed-remote-verifier",
    verifierIdentity: "reviewed-aws-ec2-credential-host-verifier",
    provenance: {
      kind: "reviewed-remote-verifier",
      evidenceRef: "evidence://credential-staging/reviewed-remote-host-verifier",
      sourceHostIdentity: "aws-ec2:i-cloud-review",
      reviewedAt: new Date().toISOString(),
    },
    awsBindMountVerified: true,
  };
  return { ...evidence, reviewedVerifierProfile: liveHostVerifierProfile(evidence) };
}

export function liveHostVerifierProfile(evidence: any) {
  return signedLiveHostVerifierProfile(evidence);
}

export async function liveBackendEvidence(tmp: string) {
  const map = JSON.parse(await fsp.readFile(path.join(tmp, "credential-map.json"), "utf8"));
  return {
    schemaVersion: "control-plane-credential-live-backend-write@1",
    checkedAt: new Date().toISOString(),
    liveGate: "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1",
    backend: "infisical",
    generatedSecretWritePlanIds: map.entries.flatMap((entry: any) =>
      entry.source.kind === "generated-secret-write-plan" ? [entry.source.writePlanRef] : [],
    ),
    backendRefs: map.entries.flatMap((entry: any) =>
      entry.source.kind === "secret-backend-ref" ? [entry.source.ref] : [],
    ),
    hostCredentialSourceIds: map.entries.flatMap((entry: any) =>
      entry.source.kind === "host-credential-source" ? [entry.source.hostSourceRef] : [],
    ),
    noSecretValuesPersisted: true,
    evidenceRef: "evidence://credential-staging/live-backend-write",
  };
}
