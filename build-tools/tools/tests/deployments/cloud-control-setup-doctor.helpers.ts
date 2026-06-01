#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { runCloudProviderCapabilityHook } from "../../deployments/cloud-control-provider-capability-hooks";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

export async function writeBundle(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fsp.writeFile(path.join(dir, name), content, "utf8");
  }
}

export function phase(result: any, id: string) {
  return result.phases.find((entry: { id: string }) => entry.id === id);
}

export function runbookCommand(commands: any, id: string) {
  const found = commands.phases
    .flatMap((entry: { commands: unknown[] }) => entry.commands)
    .find((entry: any) => entry.id === id);
  if (!found) throw new Error(`missing runbook command ${id}`);
  return found;
}

export function resolveCommandRef(commandRef: string, commands: any): unknown {
  assert.match(commandRef, /^commands\.json#\/phases\/\d+\/commands\/\d+\/command$/);
  return commandRef
    .replace("commands.json#/", "")
    .split("/")
    .reduce((current: any, segment: string) => current[segment], commands);
}

export async function writeEvidence(dir: string, output: string): Promise<void> {
  await fsp.writeFile(path.join(dir, output.slice("$PROFILE_ROOT/".length)), "{}\n", "utf8");
}

export async function writeSupabaseProviderEvidence(dir: string): Promise<void> {
  await fsp.writeFile(
    path.join(dir, "supabase-managed-postgres-evidence.json"),
    JSON.stringify(
      await runCloudProviderCapabilityHook({
        capabilityId: "supabase-managed-postgres",
        phase: "evidence",
        deploymentLabel: "//deployments:staging",
        supabasePostgresProfile: privateLinkSupabaseProfile(),
      }),
    ),
    "utf8",
  );
}

export async function writeProviderCapabilityEvidence(dir: string, commands: any): Promise<void> {
  const [topology, awsEc2Profile] = await Promise.all([
    readJson(path.join(dir, "aws-topology-evidence.json")),
    readYaml(path.join(dir, "aws-ec2-profile.yaml")),
  ]);
  const ids = commands.phases
    .flatMap((entry: { commands: Array<{ id: string }> }) => entry.commands)
    .map((entry: { id: string }) => entry.id)
    .filter((id: string) => id.startsWith("provider-capability-"))
    .map((id: string) => id.slice("provider-capability-".length));
  await Promise.all(
    ids.map(async (capabilityId: string) => {
      const evidence = await runCloudProviderCapabilityHook({
        capabilityId,
        phase: "evidence",
        deploymentLabel: "//deployments:staging",
        awsTopologyEvidence: topology,
        ...(capabilityId === "aws-ec2-control-plane-host" ? { awsEc2Profile } : {}),
        ...(capabilityId === "aws-network-foundation" || capabilityId === "aws-s3-artifact-store"
          ? { awsFoundationInspection: topology.foundation }
          : {}),
      });
      await fsp.writeFile(
        path.join(dir, `provider-capability-${capabilityId}.json`),
        JSON.stringify(evidence),
        "utf8",
      );
    }),
  );
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function readYaml(file: string): Promise<any> {
  return YAML.parse(await fsp.readFile(file, "utf8"));
}

export function setupArgPairs(
  digestRef: string,
  buildIdentity: string,
  digest: string,
): string[][] {
  return [
    ["--out", "./cloud-control-profile"],
    ["--host-mode", "aws-ec2"],
    ["--image", digestRef],
    ["--expected-image-build-identity", buildIdentity],
    ["--image-source-revision", "source-review"],
    ["--image-build-identity", buildIdentity],
    ["--image-publication-digest", digest],
    ["--image-inspected-digest", digest],
    ["--public-url", "https://deploy.example.test"],
    ["--auth-callback-host", "deploy-auth.example.test"],
    ["--deployment-id", "pleomino-staging"],
    ["--artifact-backend", "aws-s3"],
    ["--artifact-bucket", "deployment-control-plane-artifacts"],
    ["--artifact-region", "us-east-1"],
    ["--reviewed-source-mode", "ssh"],
  ];
}
