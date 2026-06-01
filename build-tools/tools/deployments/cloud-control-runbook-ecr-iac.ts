import type { RunbookCommand } from "./cloud-control-runbook";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { ecrStackInputs } from "./cloud-control-setup-ecr-iac";
import {
  AWS_ECR_EVIDENCE_PATHS,
  AWS_ECR_OPENTOFU_BACKEND,
  AWS_ECR_OPENTOFU_DIR,
  AWS_ECR_OPENTOFU_TFVARS,
} from "./cloud-control-aws-ecr-iac-evidence-rules";

export function ecrIacCommands(input: CloudControlSetupInput, prelude: string): RunbookCommand[] {
  if (input.imagePublication?.registryProfile?.mode !== "aws-ecr") return [];
  return [
    {
      id: "ecr-opentofu-plan",
      command: opentofuPlanCommand(prelude),
      cwd: "profile-root",
      actionType: "reviewed-iac",
      evidenceGuidance:
        "run reviewed OpenTofu plan from the bundle-root ECR stack, review raw plan output, then write typed plan evidence",
      inputs: [
        "$PROFILE_ROOT/registry-profile.json",
        "$PROFILE_ROOT/aws-topology-evidence.json",
        ...ecrStackInputs(),
      ],
      outputs: [
        "$PROFILE_ROOT/ecr-opentofu.tfplan",
        "$PROFILE_ROOT/ecr-opentofu-plan.out.json",
        AWS_ECR_EVIDENCE_PATHS.plan,
      ],
      mustPass: "reviewed ECR OpenTofu plan evidence is supplied from bundle-root artifacts",
    },
    {
      id: "ecr-opentofu-apply",
      command: opentofuApplyCommand(prelude),
      cwd: "profile-root",
      actionType: "reviewed-iac",
      evidenceGuidance:
        "apply the reviewed ECR OpenTofu plan, review outputs, then write typed apply evidence",
      inputs: [
        "$PROFILE_ROOT/ecr-opentofu.tfplan",
        AWS_ECR_EVIDENCE_PATHS.plan,
        ...ecrStackInputs(),
      ],
      outputs: ["$PROFILE_ROOT/ecr-opentofu-apply.out.json", AWS_ECR_EVIDENCE_PATHS.apply],
      mustPass: "reviewed ECR OpenTofu apply evidence is supplied from bundle-root artifacts",
    },
    {
      id: "ecr-readonly-evidence",
      command: readOnlyEvidenceCommand(prelude),
      cwd: "profile-root",
      actionType: "read-only-evidence",
      evidenceGuidance:
        "collect read-only ECR repository, lifecycle, policy, and scan evidence, then write typed read-only evidence",
      inputs: ["$PROFILE_ROOT/registry-profile.json", AWS_ECR_EVIDENCE_PATHS.apply],
      outputs: [
        "$PROFILE_ROOT/ecr-readonly-repository.json",
        "$PROFILE_ROOT/ecr-readonly-lifecycle-policy.json",
        "$PROFILE_ROOT/ecr-readonly-repository-policy.json",
        AWS_ECR_EVIDENCE_PATHS.readOnly,
      ],
      mustPass: "read-only AWS ECR evidence is supplied after reviewed IaC apply",
    },
  ];
}

function opentofuPlanCommand(prelude: string): string {
  return [
    prelude,
    `test -d "${AWS_ECR_OPENTOFU_DIR}"`,
    `test -f "${AWS_ECR_OPENTOFU_TFVARS}"`,
    `test -f "${AWS_ECR_OPENTOFU_BACKEND}"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ecr" tofu -chdir="${AWS_ECR_OPENTOFU_DIR}" init -input=false -backend-config="${AWS_ECR_OPENTOFU_BACKEND}"`,
    workspaceCommand(),
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ecr" tofu -chdir="${AWS_ECR_OPENTOFU_DIR}" plan -input=false -var-file="${AWS_ECR_OPENTOFU_TFVARS}" -out="$PROFILE_ROOT/ecr-opentofu.tfplan"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ecr" tofu -chdir="${AWS_ECR_OPENTOFU_DIR}" show -json "$PROFILE_ROOT/ecr-opentofu.tfplan" > "$PROFILE_ROOT/ecr-opentofu-plan.out.json"`,
    requireEvidenceFile(
      AWS_ECR_EVIDENCE_PATHS.plan,
      "write reviewed typed ECR OpenTofu plan evidence after reviewing ecr-opentofu-plan.out.json",
    ),
  ].join("; ");
}

function opentofuApplyCommand(prelude: string): string {
  return [
    prelude,
    `test -f "${AWS_ECR_EVIDENCE_PATHS.plan}"`,
    `test -f "${AWS_ECR_OPENTOFU_BACKEND}"`,
    `test -f "$PROFILE_ROOT/ecr-opentofu.tfplan"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ecr" tofu -chdir="${AWS_ECR_OPENTOFU_DIR}" init -input=false -backend-config="${AWS_ECR_OPENTOFU_BACKEND}"`,
    workspaceCommand(),
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ecr" tofu -chdir="${AWS_ECR_OPENTOFU_DIR}" apply -input=false "$PROFILE_ROOT/ecr-opentofu.tfplan"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ecr" tofu -chdir="${AWS_ECR_OPENTOFU_DIR}" output -json > "$PROFILE_ROOT/ecr-opentofu-apply.out.json"`,
    requireEvidenceFile(
      AWS_ECR_EVIDENCE_PATHS.apply,
      "write reviewed typed ECR OpenTofu apply evidence after reviewing ecr-opentofu-apply.out.json",
    ),
  ].join("; ");
}

function workspaceCommand(): string {
  return [
    `ECR_TOFU_WORKSPACE="${"${ECR_TOFU_WORKSPACE:-deployment-control-plane}"}"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ecr" tofu -chdir="${AWS_ECR_OPENTOFU_DIR}" workspace select "$ECR_TOFU_WORKSPACE" || TF_DATA_DIR="$PROFILE_ROOT/.tofu/ecr" tofu -chdir="${AWS_ECR_OPENTOFU_DIR}" workspace new "$ECR_TOFU_WORKSPACE"`,
  ].join("; ");
}

function readOnlyEvidenceCommand(prelude: string): string {
  const repoExpr =
    'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/registry-profile.json","utf8")); process.stdout.write((p.identity.repositoryArn||"").split(":repository/")[1] || p.repository.split("/").slice(1).join("/"))';
  const regionExpr =
    'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/registry-profile.json","utf8")); process.stdout.write((p.identity.region||"").trim())';
  return [
    prelude,
    `test -f "${AWS_ECR_EVIDENCE_PATHS.apply}"`,
    `ECR_REPOSITORY_NAME="$(node -e '${repoExpr}')"`,
    `AWS_REGION="$(node -e '${regionExpr}')"`,
    `aws ecr describe-repositories --repository-names "$ECR_REPOSITORY_NAME" --region "$AWS_REGION" > "$PROFILE_ROOT/ecr-readonly-repository.json"`,
    `aws ecr get-lifecycle-policy --repository-name "$ECR_REPOSITORY_NAME" --region "$AWS_REGION" > "$PROFILE_ROOT/ecr-readonly-lifecycle-policy.json"`,
    `aws ecr get-repository-policy --repository-name "$ECR_REPOSITORY_NAME" --region "$AWS_REGION" > "$PROFILE_ROOT/ecr-readonly-repository-policy.json"`,
    requireEvidenceFile(
      AWS_ECR_EVIDENCE_PATHS.readOnly,
      "write typed ECR read-only evidence after reviewing AWS ECR inspection outputs",
    ),
  ].join("; ");
}

function requireEvidenceFile(file: string, message: string): string {
  return `test -f "${file}" || { echo ${shellQuote(message)} >&2; exit 2; }`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
