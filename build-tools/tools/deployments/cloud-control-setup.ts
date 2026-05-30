import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli";
import { renderCloudControlSetupBundle } from "./cloud-control-setup-render";
import {
  assertCloudControlSetupInput,
  validateCloudControlSetupInput,
  validateProviderCapabilityDeclaration,
} from "./cloud-control-setup-validate";
import {
  assertProductionImagePublicationEvidence,
  readSetupImagePublicationFlags,
} from "./cloud-control-setup-image-publication";
import type {
  ArtifactBackend,
  CloudControlSetupInput,
  CloudProfileMode,
  ReviewedSourceMode,
} from "./cloud-control-setup-types";

export async function runCloudControlSetupCommand(): Promise<void> {
  const input = readCloudControlSetupInput();
  if (input.mode === "aws-ec2" && !input.dryRun) {
    assertProductionImagePublicationEvidence(input);
  }
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
  const imagePublication = readSetupImagePublicationFlags();
  return {
    outDir: getFlagStr("out", "cloud-control-profile").trim(),
    mode: enumFlag("host-mode", "compose-podman", [
      "compose-podman",
      "nixos",
      "saas-oci",
      "aws-ec2",
    ]),
    image: imagePublication.image,
    expectedImageBuildIdentity: imagePublication.expectedImageBuildIdentity,
    imagePublication: imagePublication.imagePublication,
    imagePublicationEvidencePath: imagePublication.imagePublicationEvidencePath,
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
    awsTopology: awsTopologyFromFlags(),
  };
}

function awsTopologyFromFlags(): CloudControlSetupInput["awsTopology"] {
  const filePath = getFlagStr("aws-topology-evidence", "").trim();
  if (!filePath) return undefined;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
    setupCommand(input, true),
    setupCommand(input, false),
    "stage credential files listed in credential-manifest.json",
    localCheckCommand("setup-doctor", input.outDir, "setup-doctor.json"),
    localCheckCommand("credential-preflight", input.outDir, "credential-preflight.json"),
    "run the ordered phases in commands.json",
  ];
}

function setupCommand(input: CloudControlSetupInput, dryRun: boolean): string {
  const publication = input.imagePublication;
  const args = [
    "deployment-control-plane",
    "setup",
    dryRun ? "--dry-run" : undefined,
    "--out",
    input.outDir,
    "--host-mode",
    input.mode,
    "--image",
    input.image || "<registry/repo@sha256:digest>",
    "--expected-image-build-identity",
    input.expectedImageBuildIdentity || "nix-source-<build-identity>",
    "--image-publication-evidence",
    publication ? "$PROFILE_ROOT/image-publication.json" : "<image-publication.json>",
    "--public-url",
    input.publicUrl,
    "--auth-callback-host",
    input.authCallbackHost,
    "--auth-callback-path",
    input.authCallbackPath,
    "--deployment-id",
    input.deploymentIds.join(","),
    "--artifact-backend",
    input.artifactBackend,
    "--artifact-bucket",
    input.artifactBucket,
    "--artifact-region",
    input.artifactRegion,
    "--reviewed-source-mode",
    input.reviewedSourceMode,
    "--service-replicas",
    String(input.serviceReplicas),
    "--worker-replicas",
    String(input.workerReplicas),
    input.artifactBackendEvidence ? "--artifact-backend-evidence" : undefined,
    input.artifactBackendEvidence || undefined,
    input.mode === "aws-ec2" ? "--aws-topology-evidence" : undefined,
    input.mode === "aws-ec2" ? "$PROFILE_ROOT/aws-topology-evidence.json" : undefined,
  ].filter((arg): arg is string => typeof arg === "string" && arg.length > 0);
  return args.map(shellArg).join(" ");
}

function localCheckCommand(command: string, outDir: string, outputFile: string): string {
  const outPath = `${outDir.replace(/\/+$/, "")}/${outputFile}`;
  return ["deployment-control-plane", command, "--bundle-dir", outDir, "--out", outPath]
    .map(shellArg)
    .join(" ");
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=,+$-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
