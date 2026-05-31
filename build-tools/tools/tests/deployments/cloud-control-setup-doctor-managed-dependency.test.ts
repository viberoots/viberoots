#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { validateRunbookBundle } from "../../deployments/cloud-control-runbook";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import type { CloudControlSetupInput } from "../../deployments/cloud-control-setup-types";
import { runInScratchTemp } from "../lib/test-helpers";
import {
  managedDependencyEvidence,
  privateLinkAwsTopology,
  topologyForPublishedImage,
} from "./cloud-control-cutover-fixture";
import { ecrRegistryProfileForImage } from "./control-plane-registry-profile.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

const DIGEST = `sha256:${"d".repeat(64)}`;
const IMAGE = `registry.example.com/platform/deployment-control-plane@${DIGEST}`;
const BUILD_IDENTITY = `nix-source-${"e".repeat(64)}`;

test("setup doctor refuses stale managed dependency evidence completion", async () => {
  await runInScratchTemp("cloud-control-setup-doctor-stale-managed", async (tmp) => {
    const bundle = renderCloudControlSetupBundle(input(tmp));
    await writeBundle(tmp, bundle.files);
    await fsp.writeFile(path.join(tmp, "setup-doctor.json"), "{}\n", "utf8");
    await fsp.writeFile(path.join(tmp, "credential-preflight.json"), "{}\n", "utf8");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await fsp.writeFile(
      path.join(tmp, "managed-dependency-evidence.json"),
      JSON.stringify(managedDependencyEvidence({ checkedAt: old })),
      "utf8",
    );
    const result = await validateRunbookBundle(tmp);
    const managed = result.phases.find((entry: any) => entry.id === "managed-dependencies");
    assert.equal(managed.status, "ready");
    assert.match(
      managed.evidenceErrors.join("\n"),
      /managed dependency evidence is missing or stale/,
    );
  });
});

async function writeBundle(root: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, "utf8");
  }
}

function input(outDir: string): CloudControlSetupInput {
  return {
    outDir,
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
    artifactBackendEvidence: "",
    deploymentIds: ["pleomino-staging"],
    reviewedSourceMode: "ssh",
    authCallbackHost: "deploy-auth.example.test",
    authCallbackPath: "/oidc/callback",
    serviceReplicas: 1,
    workerReplicas: 2,
    dryRun: false,
    awsTopology: topologyForImage(),
    supabasePostgres: privateLinkSupabaseProfile(),
  };
}

function topologyForImage() {
  return topologyForPublishedImage(privateLinkAwsTopology(), IMAGE, DIGEST);
}
