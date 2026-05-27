import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli";
import { renderCloudControlSetupBundle } from "./cloud-control-setup-render";
import {
  assertCloudControlSetupInput,
  validateCloudControlSetupInput,
  validateProviderCapabilityDeclaration,
} from "./cloud-control-setup-validate";
import type {
  ArtifactBackend,
  CloudControlSetupInput,
  CloudProfileMode,
  ReviewedSourceMode,
} from "./cloud-control-setup-types";

export async function runCloudControlSetupCommand(): Promise<void> {
  const input = readCloudControlSetupInput();
  if (input.dryRun) {
    const errors = validateCloudControlSetupInput(input);
    console.log(
      JSON.stringify(
        {
          schemaVersion: "cloud-control-setup-dry-run@1",
          ok: errors.length === 0,
          missingPrerequisites: errors,
          nextCommands: nextCommands(input),
        },
        null,
        2,
      ),
    );
    if (errors.length > 0) process.exitCode = 2;
    return;
  }
  await writeCloudControlSetupBundle(input);
  console.log(JSON.stringify({ schemaVersion: "cloud-control-setup@1", outDir: input.outDir }));
}

export async function writeCloudControlSetupBundle(input: CloudControlSetupInput): Promise<void> {
  assertCloudControlSetupInput(input);
  const bundle = renderCloudControlSetupBundle(input);
  const capabilityErrors = bundle.capabilities.flatMap(validateProviderCapabilityDeclaration);
  if (capabilityErrors.length > 0) {
    throw new Error(
      `cloud provider-capability declarations invalid: ${capabilityErrors.join("; ")}`,
    );
  }
  await fsp.mkdir(input.outDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(bundle.files)) {
    await assertNoSecretValues(relativePath, content);
    const filePath = path.join(input.outDir, relativePath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, "utf8");
  }
}

export function readCloudControlSetupInput(): CloudControlSetupInput {
  return {
    outDir: getFlagStr("out", "cloud-control-profile").trim(),
    mode: enumFlag("host-mode", "compose-podman", [
      "compose-podman",
      "nixos",
      "saas-oci",
      "aws-ec2",
    ]),
    image: getFlagStr("image", "").trim(),
    instanceId: getFlagStr("instance-id", "cloud-control-plane").trim(),
    publicUrl: getFlagStr("public-url", "https://deploy.example.test").trim(),
    artifactBucket: getFlagStr("artifact-bucket", "deployment-control-plane-artifacts").trim(),
    artifactRegion: getFlagStr("artifact-region", "us-east-1").trim(),
    artifactBackend: enumFlag("artifact-backend", "aws-s3", [
      "aws-s3",
      "supabase-storage-s3",
      "s3-compatible",
    ]),
    artifactBackendEvidence: getFlagStr("artifact-backend-evidence", "").trim(),
    deploymentIds: deploymentIds(getFlagList("deployment-id")),
    reviewedSourceMode: enumFlag("reviewed-source-mode", "ssh", ["ssh", "github-app"]),
    authCallbackHost: getFlagStr("auth-callback-host", "deploy-auth.example.test").trim(),
    authCallbackPath: getFlagStr("auth-callback-path", "/oidc/callback").trim(),
    serviceReplicas: numberFlag("service-replicas", 1),
    workerReplicas: numberFlag("worker-replicas", 2),
    dryRun: getFlagBool("dry-run"),
    supabasePrivatelink: getFlagBool("supabase-privatelink"),
    awsVpcEndpoint: getFlagBool("aws-vpc-endpoint"),
    awsSubnetIds: getFlagList("aws-subnet-id"),
    awsSecurityGroupIds: getFlagList("aws-security-group-id"),
    tlsEvidence: getFlagStr("tls-evidence", "").trim(),
  };
}

function deploymentIds(values: string[]): string[] {
  const ids = values.map((value) => value.trim()).filter(Boolean);
  return ids.length > 0 ? ids : ["cloud-control-fixture-staging"];
}

function enumFlag<T extends string>(name: string, fallback: T, values: readonly T[]): T {
  const value = getFlagStr(name, fallback).trim() as T;
  return values.includes(value) ? value : value;
}

function numberFlag(name: string, fallback: number): number {
  const value = getFlagStr(name, String(fallback)).trim();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nextCommands(input: CloudControlSetupInput): string[] {
  return [
    `deployment-control-plane setup --out ${input.outDir} --host-mode ${input.mode} --image <registry/repo@sha256:digest>`,
    "stage credential files listed in credential-manifest.json",
    "run health, readiness, worker-heartbeat, artifact, and database validation commands",
  ];
}

async function assertNoSecretValues(relativePath: string, content: string): Promise<void> {
  const forbidden = [
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /postgres(?:ql)?:\/\/[^<\s]+:[^<\s]+@/i,
    /(secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_/-]{12,}/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(content)) throw new Error(`${relativePath} appears to contain a secret value`);
  }
}

export type { ArtifactBackend, CloudControlSetupInput, CloudProfileMode, ReviewedSourceMode };
