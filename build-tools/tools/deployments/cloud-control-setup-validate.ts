import {
  ARTIFACT_BACKENDS,
  CLOUD_PROFILE_MODES,
  REVIEWED_SOURCE_MODES,
  type CloudControlSetupInput,
  type ProviderCapabilityDeclaration,
  type ReviewedSourceMode,
} from "./cloud-control-setup-types";
import {
  CREDENTIAL_FILENAMES,
  GITHUB_APP_FILENAMES,
  INFISICAL_FILENAMES,
  REQUIRED_CAPABILITY_FIELDS,
  SSH_REVIEWED_SOURCE_FILENAMES,
} from "./cloud-control-setup-contract";

const IMAGE_DIGEST_PATTERN = /^[a-z0-9][a-z0-9._:-]*(\/[a-z0-9][a-z0-9._-]*)+@sha256:[a-f0-9]{64}$/;
const SECRET_PATTERN = /(secret|token|password|private.key|access.key|database.url)=/i;

export function validateCloudControlSetupInput(input: CloudControlSetupInput): string[] {
  const errors: string[] = [];
  if (!CLOUD_PROFILE_MODES.includes(input.mode))
    errors.push(`unsupported host substrate ${input.mode}`);
  if (!IMAGE_DIGEST_PATTERN.test(input.image)) {
    errors.push("control-plane image must be a registry reference pinned by @sha256 digest");
  }
  if (!ARTIFACT_BACKENDS.includes(input.artifactBackend)) {
    errors.push(`unsupported artifact backend ${input.artifactBackend}`);
  }
  if (!REVIEWED_SOURCE_MODES.includes(input.reviewedSourceMode)) {
    errors.push(`unsupported reviewed-source mode ${input.reviewedSourceMode}`);
  }
  if (input.reviewedSourceMode === "github-app") {
    errors.push(
      "GitHub App reviewed-source mode requires a runtime adapter before setup can generate a profile",
    );
  }
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === "string" && SECRET_PATTERN.test(`${name}=${value}`)) {
      errors.push(`${name} must be a placeholder or file path, not a secret value`);
    }
  }
  if (input.workerReplicas < 2)
    errors.push("cloud control-plane profile requires at least two workers");
  if (input.serviceReplicas !== 1)
    errors.push("cloud control-plane profile expects one service process");
  if (input.deploymentIds.length === 0) {
    errors.push("cloud control-plane profile requires at least one deployment id");
  }
  for (const deploymentId of input.deploymentIds) {
    if (!/^[a-z0-9._-]+$/i.test(deploymentId)) {
      errors.push(`deployment id ${deploymentId} cannot be used in credential filenames`);
    }
  }
  if (input.mode === "aws-ec2") errors.push(...validateAwsEvidence(input));
  return errors;
}

export function validateCredentialManifestFiles(
  files: readonly string[],
  reviewedSourceMode: ReviewedSourceMode = "ssh",
): string[] {
  const errors: string[] = [];
  const required = baseCredentialFiles(reviewedSourceMode);
  for (const file of required) {
    if (!files.includes(file)) errors.push(`credential manifest missing ${file}`);
  }
  if (files.some((file) => /^env:/i.test(file))) {
    errors.push("credential manifest must not use env-var-only secret modes");
  }
  return errors;
}

function baseCredentialFiles(reviewedSourceMode: ReviewedSourceMode): string[] {
  return [
    ...CREDENTIAL_FILENAMES,
    ...INFISICAL_FILENAMES,
    ...(reviewedSourceMode === "github-app" ? GITHUB_APP_FILENAMES : SSH_REVIEWED_SOURCE_FILENAMES),
  ];
}

export function assertCloudControlSetupInput(input: CloudControlSetupInput): void {
  const errors = validateCloudControlSetupInput(input);
  if (errors.length > 0)
    throw new Error(`cloud control-plane setup rejected: ${errors.join("; ")}`);
}

export function validateProviderCapabilityDeclaration(
  declaration: ProviderCapabilityDeclaration,
): string[] {
  const errors: string[] = [];
  for (const field of REQUIRED_CAPABILITY_FIELDS) {
    const value = declaration[field];
    if (Array.isArray(value) ? value.length === 0 : !String(value || "").trim()) {
      errors.push(`${declaration.id}: ${field} must not be empty`);
    }
  }
  if (declaration.credentialSource.toLowerCase().includes("ambient")) {
    errors.push(`${declaration.id}: credentialSource must not use ambient credentials`);
  }
  for (const [name, command] of Object.entries(declaration.iac)) {
    if (name === "reviewedReference") continue;
    if (!command.includes("deploy --deployment <label>")) {
      errors.push(`${declaration.id}: iac.${name} must use reviewed deploy admission`);
    }
  }
  return errors;
}

export function validateProviderCapabilityEvidence(
  declarations: ProviderCapabilityDeclaration[],
  evidenceByCapability: Record<string, string[]>,
): string[] {
  const errors: string[] = [];
  for (const declaration of declarations) {
    const evidence = evidenceByCapability[declaration.id] || [];
    if (evidence.length === 0) {
      errors.push(`${declaration.id}: protected/shared readiness requires attached evidence`);
      continue;
    }
    for (const required of declaration.auditEvidence) {
      if (!evidence.includes(required)) {
        errors.push(`${declaration.id}: missing evidence "${required}"`);
      }
    }
  }
  return errors;
}

function validateAwsEvidence(input: CloudControlSetupInput): string[] {
  const errors: string[] = [];
  if (input.artifactBackend === "aws-s3" && !input.awsVpcEndpoint) {
    errors.push("AWS EC2 profile requires AWS S3 VPC endpoint artifact-store evidence");
  }
  if (input.artifactBackend !== "aws-s3") {
    if (!input.artifactBackendEvidence) {
      errors.push("AWS EC2 alternate artifact stores require reviewed alternate backend evidence");
    }
  }
  if (input.awsSubnetIds.length === 0) errors.push("AWS EC2 profile requires subnet evidence");
  if (input.awsSecurityGroupIds.length === 0) {
    errors.push("AWS EC2 profile requires security-group evidence");
  }
  if (!input.tlsEvidence) errors.push("AWS EC2 profile requires TLS/ALB-or-NLB/DNS evidence");
  return errors;
}
