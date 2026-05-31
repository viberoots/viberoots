#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateRunbookBundle } from "../../deployments/cloud-control-runbook";
import {
  runCredentialRotation,
  runCredentialStaging,
} from "../../deployments/control-plane-credential-staging";
import { runInScratchTemp } from "../lib/test-helpers";
import {
  capabilityEvidence,
  evidence,
  managedDependencyEvidence,
  privateLinkAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-cutover-fixture";
import { liveCredentialStagingEvidence } from "./cloud-control-credential-staging.fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import {
  phase,
  runbookCommand,
  writeBundle,
  writeEvidence,
  writeSupabaseProviderEvidence,
} from "./cloud-control-setup-doctor.helpers";

const DIGEST = `sha256:${"c".repeat(64)}`;
const IMAGE = `registry.example.com/platform/deployment-control-plane@${DIGEST}`;
const BUILD_IDENTITY = `nix-source-${"d".repeat(64)}`;

test("setup doctor blocks and unlocks cutover-readiness from generated evidence", async () => {
  await runInScratchTemp("cloud-control-setup-doctor-cutover", async (tmp) => {
    const bundle = renderCloudControlSetupBundle(input(tmp));
    await writeBundle(tmp, bundle.files);
    const commands = JSON.parse(bundle.files["commands.json"]!);
    await completePrerequisites(tmp, commands);
    const before = await validateRunbookBundle(tmp);
    assert.equal(phase(before, "http-validation").status, "complete");
    assert.equal(phase(before, "cutover-readiness").status, "blocked");

    const cutoverEvidence = evidence();
    for (const [file, value] of Object.entries(cutoverFiles(cutoverEvidence))) {
      await fsp.writeFile(path.join(tmp, file), JSON.stringify(value), "utf8");
    }
    const after = await validateRunbookBundle(tmp);
    assert.equal(phase(after, "cutover-readiness").status, "complete");
  });
});

async function completePrerequisites(tmp: string, commands: any) {
  await fsp.writeFile(path.join(tmp, "setup-doctor.json"), '{"ok":true}\n', "utf8");
  await fsp.writeFile(path.join(tmp, "credential-preflight.json"), '{"ok":true}\n', "utf8");
  const staging = await runCredentialStaging({
    bundleDir: tmp,
    out: path.join(tmp, "credential-staging.json"),
  });
  await writeLiveCredentialStagingOutput(tmp, staging);
  await runCredentialRotation({
    bundleDir: tmp,
    applyRotation: true,
    out: path.join(tmp, "credential-rotation.json"),
    rotatedMapOut: path.join(tmp, "credential-map.rotated.json"),
  });
  await writeSupabaseProviderEvidence(tmp);
  await fsp.writeFile(
    path.join(tmp, "managed-dependency-evidence.json"),
    JSON.stringify(managedDependencyEvidence()),
    "utf8",
  );
  for (const id of [
    "supabase-privatelink-support-initiation",
    "supabase-privatelink-ram-acceptance",
    "supabase-privatelink-vpc-lattice",
    "supabase-privatelink-private-dns",
    "supabase-privatelink-tcp-5432-sg",
    "supabase-privatelink-private-psql",
    "service",
    "worker-1",
    "worker-2",
    "ingress-dns",
    "ingress-tls",
    "ingress-health",
    "ingress-callback",
    "health",
    "readiness",
    "worker-heartbeats",
  ]) {
    await writeEvidence(tmp, runbookCommand(commands, id).outputs[0]);
  }
}

async function writeLiveCredentialStagingOutput(tmp: string, staging: any): Promise<void> {
  await fsp.writeFile(path.join(tmp, "live-infisical-backend.profile.json"), "{}\n", "utf8");
  await fsp.writeFile(path.join(tmp, "live-host-verifier.profile.json"), "{}\n", "utf8");
  const manifest = JSON.parse(
    await fsp.readFile(path.join(tmp, "credential-manifest.json"), "utf8"),
  );
  const credentialMap = JSON.parse(
    await fsp.readFile(path.join(tmp, "credential-map.json"), "utf8"),
  );
  await fsp.writeFile(
    path.join(tmp, "credential-staging.live.json"),
    JSON.stringify(
      liveCredentialStagingEvidence(staging.manifestDigest, staging.credentialMapDigest, {
        requiredFiles: manifest.requiredFiles,
        credentialMap,
      }),
      null,
      2,
    ),
    "utf8",
  );
}

function cutoverFiles(cutoverEvidence: any): Record<string, unknown> {
  return {
    "provider-capability-aws-ec2-control-plane-host.json": capabilityEvidence(
      "aws-ec2-control-plane-host",
    ),
    "provider-capability-aws-network-foundation.json": capabilityEvidence("aws-network-foundation"),
    "provider-capability-aws-ecr-control-plane-registry.json": capabilityEvidence(
      "aws-ecr-control-plane-registry",
    ),
    "provider-capability-aws-s3-artifact-store.json": capabilityEvidence("aws-s3-artifact-store"),
    "provider-capability-supabase-privatelink-prerequisite.json": capabilityEvidence(
      "supabase-privatelink-prerequisite",
    ),
    "standby-evidence.json": cutoverEvidence.standby,
    "restore-evidence.json": cutoverEvidence.restore,
    "rollback-evidence.json": cutoverEvidence.rollback,
    "break-glass-evidence.json": cutoverEvidence.breakGlass,
    "latest-non-production-deployment.json": cutoverEvidence.latestNonProductionDeployment,
    "cloud-cutover-evidence.json": cutoverEvidence,
    "cloud-cutover-report.json": { ok: true },
  };
}

function input(outDir: string) {
  return {
    outDir,
    mode: "aws-ec2" as const,
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
    artifactBackend: "aws-s3" as const,
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh" as const,
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: topologyForPublishedImage(privateLinkAwsTopology(), IMAGE, DIGEST),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
  };
}
