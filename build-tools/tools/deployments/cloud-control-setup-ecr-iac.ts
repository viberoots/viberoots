import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import {
  AWS_ECR_OPENTOFU_BACKEND,
  AWS_ECR_OPENTOFU_DIR,
  AWS_ECR_OPENTOFU_TFVARS,
} from "./cloud-control-aws-ecr-iac-evidence-rules";
import {
  opentofuStackInputs,
  renderOpenTofuStackFiles,
} from "./cloud-control-setup-opentofu-stack";
import type { ControlPlaneRegistryProfile } from "./control-plane-registry-profile";

export function renderEcrOpenTofuFiles(input: CloudControlSetupInput): Record<string, string> {
  const profile = input.imagePublication?.registryProfile;
  if (profile?.mode !== "aws-ecr") return {};
  return {
    ...renderOpenTofuStackFiles(),
    "ecr-opentofu.tfvars.json": `${JSON.stringify(ecrTfvars(input, profile), null, 2)}\n`,
    "ecr-backend.hcl": ecrBackendConfig(input, profile),
    "ecr-evidence-template.json": `${JSON.stringify(ecrEvidenceTemplate(), null, 2)}\n`,
  };
}

export function renderEcrIacEvidence(input: CloudControlSetupInput): Record<string, string> {
  const iac = input.imagePublication?.registryProfile?.iac;
  if (!iac) return {};
  return {
    ...(iac.plan ? { "ecr-opentofu-plan.json": `${JSON.stringify(iac.plan, null, 2)}\n` } : {}),
    ...(iac.apply ? { "ecr-opentofu-apply.json": `${JSON.stringify(iac.apply, null, 2)}\n` } : {}),
    ...(iac.readOnly
      ? { "ecr-readonly-evidence.json": `${JSON.stringify(iac.readOnly, null, 2)}\n` }
      : {}),
  };
}

export function ecrStackInputs(): string[] {
  return [AWS_ECR_OPENTOFU_BACKEND, AWS_ECR_OPENTOFU_TFVARS, ...opentofuStackInputs()];
}

function ecrBackendConfig(input: CloudControlSetupInput, profile: ControlPlaneRegistryProfile) {
  const region = input.awsTopology?.region || profile.identity.region;
  const stateBucketName = `${input.instanceId}-tofu-state`;
  const stateLockTableName = `${input.instanceId}-tofu-lock`;
  return [
    `bucket         = ${JSON.stringify(stateBucketName)}`,
    `key            = ${JSON.stringify(`aws-foundation/${input.instanceId}/ecr.tfstate`)}`,
    `region         = ${JSON.stringify(region)}`,
    `dynamodb_table = ${JSON.stringify(stateLockTableName)}`,
    "encrypt        = true",
    "",
  ].join("\n");
}

function ecrTfvars(input: CloudControlSetupInput, profile: ControlPlaneRegistryProfile) {
  return {
    region: input.awsTopology?.region || profile.identity.region,
    name_prefix: input.instanceId,
    tags: {
      owner: "deployment-control-plane",
      environment: input.deploymentIds[0] || "reviewed",
      dataClassification: "internal",
      rollback: "required",
    },
    artifact_bucket_name: input.artifactBucket,
    state_bucket_name: `${input.instanceId}-tofu-state`,
    state_lock_table_name: `${input.instanceId}-tofu-lock`,
    ecr_enabled: true,
    ecr_repository_name: repositoryName(profile),
    ecr_image_tag_mutability: "IMMUTABLE",
    ecr_scan_on_push: true,
    ecr_import_adoption_metadata: {
      mode: profile.mode === "aws-ecr" ? "managed" : "imported",
      reviewed_reference: "docs/control-plane-guide.md#prepare-registry-profilejson",
      import_block: "review and add import blocks before apply when adopting an existing ECR repo",
    },
  };
}

function ecrEvidenceTemplate() {
  return {
    templateOnly: true,
    bundleRoot: "$PROFILE_ROOT",
    workingDirectory: AWS_ECR_OPENTOFU_DIR,
    backendConfig: AWS_ECR_OPENTOFU_BACKEND,
    requiredEvidenceFiles: [
      "$PROFILE_ROOT/ecr-opentofu-plan.json",
      "$PROFILE_ROOT/ecr-opentofu-apply.json",
      "$PROFILE_ROOT/ecr-readonly-evidence.json",
    ],
    note: "Do not submit this template as evidence. Generate reviewed OpenTofu plan/apply evidence and read-only AWS ECR evidence with commands.json.",
  };
}

function repositoryName(profile: ControlPlaneRegistryProfile): string {
  const arnName = profile.identity.repositoryArn?.split(":repository/")[1];
  if (arnName) return arnName;
  return profile.repository.split("/").slice(1).join("/") || "deployment-control-plane";
}
