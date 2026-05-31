import {
  setupArtifactCredentialMode,
  setupUsesSupabasePrivateLink,
} from "./cloud-control-setup-aws-topology";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";

export function nextCommands(input: CloudControlSetupInput): string[] {
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
    "--artifact-credential-mode",
    setupArtifactCredentialMode(input),
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
    input.artifactIamRoleArn ? "--artifact-iam-role-arn" : undefined,
    input.artifactIamRoleArn,
    input.artifactLeastPrivilegePolicyDigest
      ? "--artifact-least-privilege-policy-digest"
      : undefined,
    input.artifactLeastPrivilegePolicyDigest,
    input.mode === "aws-ec2" ? "--aws-topology-evidence" : undefined,
    input.mode === "aws-ec2" ? "$PROFILE_ROOT/aws-topology-evidence.json" : undefined,
    input.supabasePostgres ? "--supabase-postgres-profile" : undefined,
    input.supabasePostgres ? "$PROFILE_ROOT/supabase-postgres.profile.json" : undefined,
    setupUsesSupabasePrivateLink(input) ? "--supabase-privatelink" : undefined,
    input.mode === "aws-ec2" ? "--ingress-command-evidence" : undefined,
    input.mode === "aws-ec2" ? ingressEvidencePaths() : undefined,
  ].filter((arg): arg is string => typeof arg === "string" && arg.length > 0);
  return args.map(shellArg).join(" ");
}

function ingressEvidencePaths(): string {
  return [
    "ingress-dns-evidence.json",
    "ingress-tls-evidence.json",
    "ingress-health-evidence.json",
    "ingress-callback-evidence.json",
  ]
    .map((name) => `$PROFILE_ROOT/${name}`)
    .join(",");
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
