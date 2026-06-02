import {
  ARTIFACT_BACKENDS,
  CLOUD_PROFILE_MODES,
  REVIEWED_SOURCE_MODES,
  type CloudControlSetupInput,
  type ProviderCapabilityDeclaration,
} from "./cloud-control-setup-types";
import { EC2_HOST_MODES, DEFAULT_EC2_HOST_MODE } from "./cloud-control-aws-ec2-host-mode";
import { assertArtifactCredentialModeAllowed } from "./control-plane-artifact-credential-mode";
import { setupArtifactCredentialMode } from "./cloud-control-setup-aws-topology";
import {
  CONCRETE_PROVIDER_CAPABILITIES,
  REQUIRED_CAPABILITY_FIELDS,
} from "./cloud-control-setup-contract";
import { validateControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";
import { evidenceSecretErrors, evidenceSourceErrors } from "./cloud-control-evidence-helpers";
import {
  awsTopologyArtifactBackend,
  awsTopologyDatabaseMode,
  validateAwsTopologyEvidence,
} from "./cloud-control-aws-topology-validate";
import { validateAwsTopologyPreApplyEvidence } from "./cloud-control-aws-topology-preapply";
import { validateIngressCommandEvidenceBundle } from "./cloud-control-aws-ingress-command-evidence";
import { validateSetupArtifactIamEvidence } from "./cloud-control-setup-artifact-iam-evidence";
import { validateSupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-validation";
import { validateSetupRuntimeInput } from "./cloud-control-setup-runtime-validation";
export { validateCredentialManifestFiles } from "./cloud-control-credential-manifest-validate";

const IMAGE_DIGEST_PATTERN = /^[a-z0-9][a-z0-9._:-]*(\/[a-z0-9][a-z0-9._-]*)+@sha256:[a-f0-9]{64}$/;
const SECRET_PATTERN = /(secret|token|password|private.key|access.key|database.url)=/i;

export function validateCloudControlSetupInput(input: CloudControlSetupInput): string[] {
  const errors: string[] = [];
  if (!CLOUD_PROFILE_MODES.includes(input.mode))
    errors.push(`unsupported host substrate ${input.mode}`);
  if (
    input.mode !== "aws-ec2" &&
    input.ec2HostMode &&
    input.ec2HostMode !== DEFAULT_EC2_HOST_MODE
  ) {
    errors.push("--ec2-host-mode is only supported with --host-mode aws-ec2");
  }
  if (input.ec2HostMode && !EC2_HOST_MODES.includes(input.ec2HostMode)) {
    errors.push(`unsupported EC2 host mode ${input.ec2HostMode}`);
  }
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
        expectedRegistryAccountId: input.awsTopology?.accountId,
        expectedRegistryRegion: input.awsTopology?.region,
      },
    ),
  );
  if (!ARTIFACT_BACKENDS.includes(input.artifactBackend))
    errors.push(`unsupported artifact backend ${input.artifactBackend}`);
  try {
    assertArtifactCredentialModeAllowed({
      provider: input.artifactBackend,
      credentialMode: setupArtifactCredentialMode(input),
      fieldName: "--artifact-credential-mode",
    });
  } catch (error) {
    errors.push(String((error as Error).message || error));
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
  errors.push(...validateSetupSupabasePostgres(input));
  errors.push(...validateSetupRuntimeInput(input));
  return errors;
}
function validateSetupSupabasePostgres(input: CloudControlSetupInput): string[] {
  if (!input.supabasePostgres)
    return ["cloud control-plane setup requires Supabase Postgres profile"];
  const mode = awsTopologyDatabaseMode(input.awsTopology) || "public";
  return validateSupabaseManagedPostgresProfile(input.supabasePostgres, {
    expectedRegion: input.mode === "aws-ec2" ? input.awsTopology?.region : input.artifactRegion,
    expectedMode: mode,
  });
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
  return /^deployment-control-plane provider-capability --deployment-id (?:<label>|'[^']+'|[^\s]+)/.test(
    command,
  );
}

function normalizeProviderCommand(command: string): string {
  return command.replace(
    /^deployment-control-plane provider-capability --deployment-id (?:<label>|'[^']+'|[^\s]+)/,
    "deployment-control-plane provider-capability --deployment-id <label>",
  );
}

function validateAwsEvidence(input: CloudControlSetupInput): string[] {
  const errors = [
    ...evidenceSourceErrors(input.awsTopology, "cloudControlSetup.awsTopology"),
    ...evidenceSecretErrors(input.awsTopology, "cloudControlSetup.awsTopology"),
    ...validateSetupAwsTopology(input),
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
  if (
    input.ec2HostMode === "repo-owned-asg" &&
    input.awsTopology?.compute?.mode !== "auto-scaling-group"
  ) {
    errors.push(
      "--ec2-host-mode repo-owned-asg requires AWS topology compute.mode auto-scaling-group",
    );
  }
  if (setupArtifactCredentialMode(input) === "aws-instance-profile") {
    errors.push(...validateSetupArtifactIamEvidence(input));
  }
  return errors;
}

function validateSetupAwsTopology(input: CloudControlSetupInput): string[] {
  const opts = {
    maxAgeMinutes: 60,
    expectedImage: input.image,
    expectedImageDigest: input.imagePublication?.digest,
    expectedPublicUrl: input.publicUrl,
    expectedAuthCallbackHost: input.authCallbackHost,
    expectedAuthCallbackPath: input.authCallbackPath,
  };
  if (input.ec2HostMode === "repo-owned-asg" && input.ec2AsgEvidenceMode !== "post-apply") {
    return validateAwsTopologyPreApplyEvidence(input.awsTopology, opts);
  }
  return validateAwsTopologyEvidence(input.awsTopology, opts);
}
