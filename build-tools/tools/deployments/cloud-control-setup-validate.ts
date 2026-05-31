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
  CONCRETE_PROVIDER_CAPABILITIES,
  GITHUB_APP_FILENAMES,
  INFISICAL_FILENAMES,
  REQUIRED_CAPABILITY_FIELDS,
  SSH_REVIEWED_SOURCE_FILENAMES,
} from "./cloud-control-setup-contract";
import { validateControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";
import { evidenceSecretErrors, evidenceSourceErrors } from "./cloud-control-evidence-helpers";
import {
  awsTopologyArtifactBackend,
  awsTopologyDatabaseMode,
  validateAwsTopologyEvidence,
} from "./cloud-control-aws-topology-validate";
import { validateIngressCommandEvidenceBundle } from "./cloud-control-aws-ingress-command-evidence";
import {
  hookEvidenceDeclaration,
  hookEvidenceRefs,
  providerCapabilityHookEvidenceRecord,
  validateProviderCapabilityHookEvidenceShape,
} from "./cloud-control-provider-capability-hook-contract";

const IMAGE_DIGEST_PATTERN = /^[a-z0-9][a-z0-9._:-]*(\/[a-z0-9][a-z0-9._-]*)+@sha256:[a-f0-9]{64}$/;
const SECRET_PATTERN = /(secret|token|password|private.key|access.key|database.url)=/i;
const INVALID_EVIDENCE_SOURCE = /\b(dashboard-only|raw-iac-only|manual-notes?)\b/i;

export function validateCloudControlSetupInput(input: CloudControlSetupInput): string[] {
  const errors: string[] = [];
  if (!CLOUD_PROFILE_MODES.includes(input.mode))
    errors.push(`unsupported host substrate ${input.mode}`);
  if (!IMAGE_DIGEST_PATTERN.test(input.image)) {
    errors.push("control-plane image must be a registry reference pinned by @sha256 digest");
  }
  if (!input.expectedImageBuildIdentity) {
    errors.push("control-plane setup requires expected image build identity");
  }
  errors.push(
    ...validateControlPlaneImagePublicationEvidence(
      input.imagePublication,
      input.image,
      input.expectedImageBuildIdentity,
      {
        requireGeneratedEvidence: input.mode === "aws-ec2" && !input.dryRun,
        requireRegistryProfile: input.mode === "aws-ec2" && !input.dryRun,
        expectedRuntimeHostProfile: input.mode === "aws-ec2" ? "aws-ec2" : undefined,
      },
    ),
  );
  if (!ARTIFACT_BACKENDS.includes(input.artifactBackend)) {
    errors.push(`unsupported artifact backend ${input.artifactBackend}`);
  }
  if (!REVIEWED_SOURCE_MODES.includes(input.reviewedSourceMode)) {
    errors.push(`unsupported reviewed-source mode ${input.reviewedSourceMode}`);
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
  const concrete =
    CONCRETE_PROVIDER_CAPABILITIES[declaration.id as keyof typeof CONCRETE_PROVIDER_CAPABILITIES];
  if (!concrete) {
    errors.push(`${declaration.id || "<missing>"}: unknown provider-capability declaration`);
  }
  for (const field of REQUIRED_CAPABILITY_FIELDS) {
    const value = declaration[field];
    if (Array.isArray(value) ? value.length === 0 : !String(value || "").trim()) {
      errors.push(`${declaration.id}: ${field} must not be empty`);
    }
  }
  if (concrete && !matchesConcreteCapability(declaration, concrete)) {
    errors.push(`${declaration.id}: declaration must match the concrete capability catalog`);
  }
  if (
    String(declaration.credentialSource || "")
      .toLowerCase()
      .includes("ambient")
  ) {
    errors.push(`${declaration.id}: credentialSource must not use ambient credentials`);
  }
  for (const [name, command] of Object.entries(declaration.iac || {})) {
    if (name === "reviewedReference") continue;
    if (!usesReviewedDeployAdmission(command)) {
      errors.push(`${declaration.id}: iac.${name} must use reviewed deploy admission`);
    }
  }
  return errors;
}

function matchesConcreteCapability(
  declaration: ProviderCapabilityDeclaration,
  concrete: ProviderCapabilityDeclaration,
): boolean {
  const fields = ["id", ...REQUIRED_CAPABILITY_FIELDS] as const;
  const iacFields = Object.keys(concrete.iac) as Array<keyof ProviderCapabilityDeclaration["iac"]>;
  return (
    fields.every(
      (field) => JSON.stringify(declaration[field]) === JSON.stringify(concrete[field]),
    ) &&
    iacFields.every(
      (field) =>
        normalizeProviderCommand(declaration.iac?.[field] || "") ===
        normalizeProviderCommand(concrete.iac[field]),
    )
  );
}

function usesReviewedDeployAdmission(command: string): boolean {
  return /^deploy --deployment (?:<label>|'[^']+'|[^\s]+)/.test(command);
}

function normalizeProviderCommand(command: string): string {
  return command.replace(
    /^deploy --deployment (?:<label>|'[^']+'|[^\s]+)/,
    "deploy --deployment <label>",
  );
}

export function validateProviderCapabilityEvidence(
  declarations: ProviderCapabilityDeclaration[],
  evidenceByCapability: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const declaration of declarations) {
    errors.push(...validateProviderCapabilityDeclaration(declaration));
    const evidence = providerCapabilityHookEvidenceRecord(evidenceByCapability[declaration.id]);
    if (!evidence) {
      errors.push(`${declaration.id}: protected/shared readiness requires hook evidence`);
      continue;
    }
    errors.push(
      ...validateProviderCapabilityHookEvidenceShape(declaration.id, evidence, {
        allowedPhases: ["evidence"],
      }),
    );
    const evidenceDeclaration = hookEvidenceDeclaration(evidence);
    if (!evidenceDeclaration) {
      errors.push(`${declaration.id}: missing hook declaration evidence`);
    } else if (!matchesConcreteCapability(evidenceDeclaration, declaration)) {
      errors.push(`${declaration.id}: hook declaration does not match selected capability`);
    }
    const refs = hookEvidenceRefs(evidence);
    if (refs.length === 0) {
      errors.push(`${declaration.id}: protected/shared readiness requires hook audit evidence`);
      continue;
    }
    const invalidEvidence = refs.find((item) => INVALID_EVIDENCE_SOURCE.test(item));
    if (invalidEvidence) {
      errors.push(`${declaration.id}: ${invalidEvidence} is not control-plane audit evidence`);
    }
    for (const required of declaration.auditEvidence) {
      if (!refs.includes(required)) {
        errors.push(`${declaration.id}: missing evidence "${required}"`);
      }
    }
  }
  return errors;
}

function validateAwsEvidence(input: CloudControlSetupInput): string[] {
  const errors = [
    ...evidenceSourceErrors(input.awsTopology, "cloudControlSetup.awsTopology"),
    ...evidenceSecretErrors(input.awsTopology, "cloudControlSetup.awsTopology"),
    ...validateAwsTopologyEvidence(input.awsTopology, {
      maxAgeMinutes: 60,
      expectedImage: input.image,
      expectedImageDigest: input.imagePublication?.digest,
      expectedPublicUrl: input.publicUrl,
      expectedAuthCallbackHost: input.authCallbackHost,
      expectedAuthCallbackPath: input.authCallbackPath,
    }),
    ...validateIngressCommandEvidenceBundle(input.awsTopology, input.ingressCommandEvidence, {
      maxAgeMinutes: 60,
      required:
        input.requireIngressCommandEvidence === true || Boolean(input.ingressCommandEvidence),
    }),
  ];
  if (
    input.awsTopology &&
    awsTopologyArtifactBackend(input.awsTopology) !== input.artifactBackend
  ) {
    errors.push("AWS topology artifact backend does not match selected setup artifact backend");
  }
  if (
    input.supabasePrivatelink === true &&
    awsTopologyDatabaseMode(input.awsTopology) !== "privatelink"
  ) {
    errors.push("--supabase-privatelink requires awsTopology.database.mode privatelink");
  }
  return errors;
}
