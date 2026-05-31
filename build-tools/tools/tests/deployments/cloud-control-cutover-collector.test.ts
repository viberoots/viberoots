#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { test } from "node:test";
import { collectCutoverEvidence } from "../../deployments/cloud-control-cutover-evidence-collector";
import { validateCloudControlCutover } from "../../deployments/cloud-control-cutover-validate";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { runCredentialStaging } from "../../deployments/control-plane-credential-staging";
import { digestCredentialInput } from "../../deployments/control-plane-credential-staging-evidence";
import { runInScratchTemp } from "../lib/test-helpers";
import {
  capabilityEvidence,
  evidence,
  IMAGE_BUILD_IDENTITY,
  IMAGE_REF,
  imagePublicationEvidence,
  managedDependencyEvidence,
  privateLinkAwsTopology,
} from "./cloud-control-cutover-fixture";
import { ingressCommandEvidence } from "./cloud-control-aws-ingress.fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { writeBundle, writeSupabaseProviderEvidence } from "./cloud-control-setup-doctor.helpers";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

test("generated cutover evidence collector output is accepted by cutover validation", async () => {
  await runInScratchTemp("cloud-cutover-collector", async (tmp) => {
    await writeBundle(tmp, renderCloudControlSetupBundle(setupInput(tmp)).files);
    await writeCutoverInputs(tmp);
    const collected = await collectCutoverEvidence(tmp);
    const result = validateCloudControlCutover(collected, {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
      expectedRegion: "us-east-1",
      selectedCapabilities: collected.selectedProviderCapabilities || [],
      maxAgeMinutes: 60,
    });
    assert.equal(result.ok, true, result.errors.join("\n"));
  });
});

async function writeCutoverInputs(tmp: string): Promise<void> {
  await writeSupabaseProviderEvidence(tmp);
  const credentialStaging = await runCredentialStaging({
    bundleDir: tmp,
    out: path.join(tmp, "credential-staging.json"),
  });
  const config = YAML.parse(await fsp.readFile(path.join(tmp, "config.yaml"), "utf8"));
  const operationBinding = {
    configDigest: digestCredentialInput(config),
    credentialManifestDigest: credentialStaging.manifestDigest,
  };
  for (const id of providerEvidenceIds()) {
    await fsp.writeFile(
      path.join(tmp, `provider-capability-${id}.json`),
      JSON.stringify(capabilityEvidence(id)),
      "utf8",
    );
  }
  for (const file of runtimeEvidenceFiles()) {
    await fsp.writeFile(
      path.join(tmp, file),
      JSON.stringify(inputEvidence(file, operationBinding)),
      "utf8",
    );
  }
}

function providerEvidenceIds(): string[] {
  return [
    "aws-ec2-control-plane-host",
    "aws-network-foundation",
    "aws-ecr-control-plane-registry",
    "aws-s3-artifact-store",
    "supabase-privatelink-prerequisite",
  ];
}

function runtimeEvidenceFiles(): string[] {
  return [
    "managed-dependency-evidence.json",
    "standby-evidence.json",
    "restore-evidence.json",
    "rollback-evidence.json",
    "break-glass-evidence.json",
    "latest-non-production-deployment.json",
    "ingress-dns-evidence.json",
    "ingress-tls-evidence.json",
    "ingress-health-evidence.json",
    "ingress-callback-evidence.json",
    "http-health.json",
    "http-readiness.json",
    "http-worker-heartbeats.json",
  ];
}

function inputEvidence(file: string, binding: Record<string, string>): unknown {
  if (file === "managed-dependency-evidence.json") return managedDependencyEvidence();
  if (file === "standby-evidence.json") return collectorHost(evidence().standby, binding);
  if (file === "restore-evidence.json") return collectorHost(evidence().restore, binding);
  if (file === "rollback-evidence.json") return collectorHost(evidence().rollback, binding);
  if (file === "break-glass-evidence.json") return collectorHost(evidence().breakGlass, binding);
  if (file === "latest-non-production-deployment.json") {
    return evidence().latestNonProductionDeployment;
  }
  const ingress = ingressCommandEvidence();
  if (file === "ingress-dns-evidence.json") return ingress.dns;
  if (file === "ingress-tls-evidence.json") return ingress.tls;
  if (file === "ingress-health-evidence.json") return ingress.health;
  if (file === "ingress-callback-evidence.json") return ingress.callback;
  return { evidenceRef: file, checkedAt: new Date().toISOString() };
}

function collectorHost(value: unknown, binding: Record<string, string>): unknown {
  return {
    ...(value as Record<string, unknown>),
    ...binding,
    sourceHost: "i-0abc1234",
  };
}

function setupInput(outDir: string) {
  return {
    outDir,
    mode: "aws-ec2" as const,
    image: IMAGE_REF,
    expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
    imagePublication: { ...imagePublicationEvidence(), evidenceSource: "generated-command" },
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
    awsTopology: privateLinkAwsTopology(),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
  };
}
