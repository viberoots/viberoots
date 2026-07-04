#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { validateRuntimeHttpOutput } from "../../deployments/cloud-control-runbook-runtime-http-evidence";
import { runInScratchTemp } from "../lib/test-helpers";
import { runtimeHttpEvidence } from "./cloud-control-cutover-fixture";
import { reviewedRuntimeInput } from "./cloud-control-runtime-input.fixture";
import { writeBundle } from "./cloud-control-setup-doctor.helpers";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";
import { privateLinkAwsTopology, topologyForPublishedImage } from "./cloud-control-cutover-fixture";

const DIGEST =
  "registry.example.com/platform/deployment-control-plane@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const IMAGE_DIGEST = `sha256:${"c".repeat(64)}`;
const BUILD_IDENTITY = `nix-source-${"d".repeat(64)}`;

test("setup doctor uses config worker count for runtime HTTP validation", async () => {
  await runInScratchTemp("cloud-control-setup-doctor-worker-count", async (tmp) => {
    const bundle = renderCloudControlSetupBundle(input(tmp));
    await writeBundle(tmp, bundle.files);
    await fsp.writeFile(
      path.join(tmp, "http-worker-heartbeats.json"),
      JSON.stringify(loweredWorkerHeartbeatEvidence()),
      "utf8",
    );
    const errors = await validateRuntimeHttpOutput(
      tmp,
      "$PROFILE_ROOT/http-worker-heartbeats.json",
    );
    assert.match(errors.join("\n"), /missing expected worker heartbeat count/);
  });
});

test("setup doctor reports runtime HTTP expected field drift from config", async () => {
  await runInScratchTemp("cloud-control-setup-doctor-expected-fields", async (tmp) => {
    await writeBundle(tmp, renderCloudControlSetupBundle(input(tmp)).files);
    await fsp.writeFile(
      path.join(tmp, "http-health.json"),
      JSON.stringify(withExpected(runtimeHttpEvidence("health"), {})),
      "utf8",
    );
    const missing = await validateRuntimeHttpOutput(tmp, "$PROFILE_ROOT/http-health.json");
    assert.match(missing.join("\n"), /expected\.deploymentIds missing/);
    assert.match(missing.join("\n"), /expected\.workerCount missing/);
    await fsp.writeFile(
      path.join(tmp, "http-health.json"),
      JSON.stringify(
        withExpected(runtimeHttpEvidence("health"), {
          deploymentIds: ["tampered"],
          workerCount: 99,
        }),
      ),
      "utf8",
    );
    const mismatched = await validateRuntimeHttpOutput(tmp, "$PROFILE_ROOT/http-health.json");
    assert.match(
      mismatched.join("\n"),
      /expected\.deploymentIds do not match trusted runtime config/,
    );
    assert.match(
      mismatched.join("\n"),
      /expected\.workerCount does not match trusted runtime config/,
    );
  });
});

function loweredWorkerHeartbeatEvidence() {
  const value = runtimeHttpEvidence("worker-heartbeats");
  return {
    ...value,
    expected: { ...(value as any).expected, profileIdentity: "i-0abc1234", workerCount: 1 },
    body: {
      workers: [
        {
          workerId: "worker-1",
          instanceId: "i-0abc1234",
          status: "running",
          lastSeenAt: new Date().toISOString(),
        },
      ],
    },
  };
}

function withExpected(value: unknown, expected: Record<string, unknown>) {
  return { ...(value as any), expected };
}

function input(outDir: string) {
  return {
    outDir,
    mode: "aws-ec2" as const,
    image: DIGEST,
    expectedImageBuildIdentity: BUILD_IDENTITY,
    imagePublication: {
      image: DIGEST,
      sourceRevision: "source-review",
      imageBuildIdentity: BUILD_IDENTITY,
      digest: IMAGE_DIGEST,
      inspectedDigest: IMAGE_DIGEST,
      tag: "registry.example.com/platform/deployment-control-plane:source-review",
      evidenceSource: "generated-command" as const,
      registryProfile: ecrRegistryProfileForImage(DIGEST, IMAGE_DIGEST),
    },
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
    awsTopology: topologyForPublishedImage(privateLinkAwsTopology(), DIGEST, IMAGE_DIGEST),
    supabasePostgres: privateLinkSupabaseProfile(),
    runtimeInput: reviewedRuntimeInput(),
  };
}
