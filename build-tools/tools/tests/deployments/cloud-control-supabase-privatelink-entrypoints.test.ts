#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { runCloudControlSetupCommand } from "../../deployments/cloud-control-setup";
import { runControlPlaneManagedDependenciesCli } from "../../deployments/control-plane-managed-dependencies";
import { renderCloudControlSetupBundle } from "../../deployments/cloud-control-setup-render";
import { runInScratchTemp } from "../lib/test-helpers";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";
import {
  IMAGE_DIGEST,
  IMAGE_REF,
  imagePublicationEvidence,
  publicAwsTopology,
  topologyForPublishedImage,
  privateLinkAwsTopology,
} from "./cloud-control-cutover-fixture";
import { setupInput } from "./control-plane-managed-dependencies-runtime-path.fixture";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

test("setup CLI rejects --supabase-privatelink when topology selects public database mode", async () => {
  await runInScratchTemp("setup-privatelink-flag-conflict", async (tmp) => {
    const topology = path.join(tmp, "aws-topology.json");
    const imagePublication = path.join(tmp, "image-publication.json");
    await fsp.writeFile(
      topology,
      JSON.stringify(topologyForPublishedImage(publicAwsTopology(), IMAGE_REF, IMAGE_DIGEST)),
    );
    await fsp.writeFile(
      imagePublication,
      JSON.stringify({
        schemaVersion: "cloud-control-image-publication@1",
        ...imagePublicationEvidence(),
      }),
    );
    const result = await captureSetup([
      "setup",
      "--dry-run",
      "--host-mode",
      "aws-ec2",
      "--aws-topology-evidence",
      topology,
      "--image-publication-evidence",
      imagePublication,
      "--supabase-privatelink",
    ]);
    assert.equal(result.ok, false);
    assert.match(result.missingPrerequisites.join("\n"), /--supabase-privatelink/);
  });
});

test("setup CLI accepts --supabase-privatelink when topology selects PrivateLink mode", async () => {
  await runInScratchTemp("setup-privatelink-flag-valid", async (tmp) => {
    const topology = path.join(tmp, "aws-topology.json");
    const imagePublication = path.join(tmp, "image-publication.json");
    await fsp.writeFile(
      topology,
      JSON.stringify(topologyForPublishedImage(privateLinkAwsTopology(), IMAGE_REF, IMAGE_DIGEST)),
    );
    await fsp.writeFile(
      imagePublication,
      JSON.stringify({
        schemaVersion: "cloud-control-image-publication@1",
        ...imagePublicationEvidence(),
      }),
    );
    const result = await captureSetup([
      "setup",
      "--dry-run",
      "--host-mode",
      "aws-ec2",
      "--aws-topology-evidence",
      topology,
      "--image-publication-evidence",
      imagePublication,
      "--supabase-privatelink",
    ]);
    assert.doesNotMatch(result.missingPrerequisites.join("\n"), /--supabase-privatelink/);
    assert.match(result.nextCommands.join("\n"), /--supabase-privatelink/);
  });
});

test("setup CLI fails PrivateLink topology missing PR 8 evidence fields", async () => {
  await runInScratchTemp("setup-privatelink-missing-evidence", async (tmp) => {
    const topology = path.join(tmp, "aws-topology.json");
    const imagePublication = path.join(tmp, "image-publication.json");
    const base = topologyForPublishedImage(
      privateLinkAwsTopology(),
      IMAGE_REF,
      IMAGE_DIGEST,
    ) as any;
    await fsp.writeFile(
      topology,
      JSON.stringify({
        ...base,
        database: {
          mode: "privatelink",
          privatelink: {
            ...base.database.privatelink,
            ramShareStatus: undefined,
            securityGroupRuleProof: undefined,
            publicConnectivity: undefined,
            databaseUrl: undefined,
          },
        },
      }),
    );
    await fsp.writeFile(
      imagePublication,
      JSON.stringify({
        schemaVersion: "cloud-control-image-publication@1",
        ...imagePublicationEvidence(),
      }),
    );
    const result = await captureSetup([
      "setup",
      "--dry-run",
      "--host-mode",
      "aws-ec2",
      "--aws-topology-evidence",
      topology,
      "--image-publication-evidence",
      imagePublication,
    ]);
    const errors = result.missingPrerequisites.join("\n");
    assert.match(errors, /RAM share is not accepted/);
    assert.match(errors, /TCP 5432 security-group rule/);
    assert.match(errors, /public database connectivity status/);
    assert.match(errors, /database URL hostname/);
  });
});

test("generated managed dependency runbook has concrete Supabase project and region", () => {
  const bundle = renderCloudControlSetupBundle(setupInput());
  const profile = YAML.parse(bundle.files["managed-dependencies.profile.yaml"]!);
  const commands = JSON.parse(bundle.files["commands.json"]!);
  const command = commands.phases
    .flatMap((phase: any) => phase.commands)
    .find((entry: any) => entry.id === "database").command;
  assert.equal(profile.runtimePath.expectedSupabaseProjectRef, "project-review");
  assert.equal(profile.runtimePath.expectedSupabaseRegion, "us-east-1");
  assert.match(command, /supabase-project-ref 'project-review'/);
  assert.match(command, /supabase-region 'us-east-1'/);
  assert.doesNotMatch(command, /MANAGED_DEPENDENCY_SUPABASE_/);
});

test("managed dependency CLI rejects public Supabase URL in PrivateLink mode", async () => {
  await runInScratchTemp("managed-dependency-public-host", async (tmp) => {
    const creds = path.join(tmp, "creds");
    await fsp.mkdir(creds);
    await fsp.writeFile(
      path.join(creds, "control-plane-database-url"),
      "postgres://user:pass@db.project-review.supabase.co/postgres?sslmode=require",
    );
    await writeArtifactCredentials(creds);
    const profile = path.join(tmp, "profile.yaml");
    await fsp.writeFile(profile, managedProfile(creds));
    await assert.rejects(
      () =>
        withControlPlaneArgv(
          [
            "managed-dependencies",
            "--profile",
            profile,
            "--credential-directory",
            creds,
            "--host-profile",
            "aws-ec2",
            "--aws-region",
            "us-east-1",
            "--source-host-identity",
            "i-0abc1234",
            "--source-host-kind",
            "aws-ec2",
          ],
          runControlPlaneManagedDependenciesCli,
        ),
      /public Supabase database hostname/,
    );
  });
});

async function captureSetup(argv: string[]) {
  const previousExitCode = process.exitCode;
  const output: string[] = [];
  const previousLog = console.log;
  console.log = (message?: unknown) => output.push(String(message));
  process.exitCode = undefined;
  try {
    await withControlPlaneArgv(argv, runCloudControlSetupCommand);
    return JSON.parse(output.join("\n"));
  } finally {
    console.log = previousLog;
    process.exitCode = previousExitCode;
  }
}

async function writeArtifactCredentials(creds: string) {
  await fsp.writeFile(path.join(creds, "artifact-store-endpoint"), "http://127.0.0.1:9");
  await fsp.writeFile(path.join(creds, "artifact-store-access-key-id"), "access");
  await fsp.writeFile(path.join(creds, "artifact-store-secret-access-key"), "secret");
}

function managedProfile(creds: string) {
  return `
profileName: aws-runtime-review
supabasePostgres: ${JSON.stringify(privateLinkSupabaseProfile())}
runtimePath:
  expectedHostProfile: aws-ec2
  expectedAwsRegion: us-east-1
  databaseConnectivityMode: privatelink
  expectedSupabaseProjectRef: project-review
  expectedSupabaseRegion: us-east-1
  expectedPrivateLinkEndpointId: vpce-privatelink123
postgres:
  provider: supabase-postgres
  urlFile: ${creds}/control-plane-database-url
artifactStore:
  provider: aws-s3
  bucket: deployment-control-plane-artifacts
  region: us-east-1
  endpointFile: ${creds}/artifact-store-endpoint
  accessKeyIdFile: ${creds}/artifact-store-access-key-id
  secretAccessKeyFile: ${creds}/artifact-store-secret-access-key
`;
}
