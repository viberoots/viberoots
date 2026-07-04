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
  runtimeHttpEvidence,
} from "./cloud-control-cutover-fixture";
import { liveCredentialStagingEvidence } from "./cloud-control-credential-staging.fixture";
import { ingressCommandEvidence } from "./cloud-control-aws-ingress.fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { writeBundle, writeSupabaseProviderEvidence } from "./cloud-control-setup-doctor.helpers";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

test("generated cutover evidence collector output is accepted by cutover validation", async () => {
  await runInScratchTemp("cloud-cutover-collector", async (tmp) => {
    await writeBundle(tmp, renderCloudControlSetupBundle(setupInput(tmp)).files);
    await writeCutoverInputs(tmp);
    const collected = await collectCutoverEvidence(tmp);
    assert.equal(
      (collected.health?.cloudHealth as any)?.schemaVersion,
      "cloud-control-runtime-http-evidence@1",
    );
    assert.equal((collected.health?.readiness as any)?.dependencies?.database?.ok, true);
    assert.equal((collected.health?.workerHeartbeats as any)?.body?.workers.length, 2);
    assert.equal(collected.expectedWorkerCount, 2);
    assert.deepEqual((collected.runtimeConfig as any).deploymentIds, ["sample-webapp-staging"]);
    assert.equal((collected.runtimeConfig as any).workers.expectedCount, 2);
    const result = validateCloudControlCutover(collected, {
      operation: "cutover",
      expectedHostProfile: "aws-ec2",
      expectedImageBuildIdentity: IMAGE_BUILD_IDENTITY,
      expectedRegion: "us-east-1",
      selectedCapabilities: collected.selectedProviderCapabilities || [],
      maxAgeMinutes: 60,
    });
    assert.equal(result.ok, true, result.errors.join("\n"));
    await fsp.writeFile(
      path.join(tmp, "http-health.json"),
      JSON.stringify(withTamperedExpected(collected.health?.cloudHealth)),
      "utf8",
    );
    const tampered = await collectCutoverEvidence(tmp);
    assert.deepEqual(tampered.runtimeConfig?.deploymentIds, ["sample-webapp-staging"]);
    assert.equal((tampered.runtimeConfig?.workers as any).expectedCount, 2);
  });
});

async function writeCutoverInputs(tmp: string): Promise<void> {
  await writeSupabaseProviderEvidence(tmp);
  const credentialStaging = await runCredentialStaging({
    bundleDir: tmp,
    out: path.join(tmp, "credential-staging.json"),
  });
  const liveStaging = liveCredentialStagingEvidence(
    credentialStaging.manifestDigest,
    credentialStaging.credentialMapDigest,
    {
      requiredFiles: JSON.parse(
        await fsp.readFile(path.join(tmp, "credential-manifest.json"), "utf8"),
      ).requiredFiles,
      credentialMap: JSON.parse(await fsp.readFile(path.join(tmp, "credential-map.json"), "utf8")),
    },
  );
  await fsp.writeFile(
    path.join(tmp, "credential-staging.live.json"),
    JSON.stringify(liveStaging, null, 2),
    "utf8",
  );
  const config = YAML.parse(await fsp.readFile(path.join(tmp, "config.yaml"), "utf8"));
  const operationBinding = {
    configDigest: digestCredentialInput(config),
    credentialManifestDigest: liveStaging.manifestDigest,
    credentialMapDigest: liveStaging.credentialMapDigest,
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
  if (file === "http-health.json") return collectorRuntimeHttp("health");
  if (file === "http-readiness.json") return collectorRuntimeHttp("readiness");
  if (file === "http-worker-heartbeats.json") return collectorRuntimeHttp("worker-heartbeats");
  return { evidenceRef: file, checkedAt: new Date().toISOString() };
}

function collectorRuntimeHttp(check: "health" | "readiness" | "worker-heartbeats") {
  const value = runtimeHttpEvidence(check);
  return {
    ...value,
    expected: {
      ...(value as any).expected,
      profileIdentity: "i-0abc1234",
      workerCount: 2,
    },
    body:
      check === "worker-heartbeats"
        ? { workers: ["worker-1", "worker-2"].map((workerId) => worker(workerId)) }
        : check === "readiness"
          ? readinessBody("i-0abc1234")
          : check === "health"
            ? { ok: true, instanceId: "i-0abc1234" }
            : (value as any).body,
    ...(check === "readiness" ? { dependencies: readinessDependencies("i-0abc1234") } : {}),
  };
}

function withTamperedExpected(value: unknown) {
  return { ...(value as any), expected: { deploymentIds: ["tampered"], workerCount: 99 } };
}

function readinessDependencies(profileIdentity: string) {
  return {
    database: { ok: true },
    artifactStore: { ok: true },
    workerQueueLocks: { ok: true },
    runtimeConfig: { ok: true, profileIdentity },
  };
}

function readinessBody(profileIdentity: string) {
  return { ok: true, ...readinessDependencies(profileIdentity) };
}

function worker(workerId: string) {
  return {
    workerId,
    instanceId: "i-0abc1234",
    status: "running",
    lastSeenAt: new Date().toISOString(),
  };
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
    deploymentIds: ["sample-webapp-staging"],
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
