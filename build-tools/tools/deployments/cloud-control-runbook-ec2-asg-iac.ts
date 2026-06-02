import type { RunbookCommand } from "./cloud-control-runbook";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import {
  EC2_ASG_OPENTOFU_DIR,
  EC2_ASG_OPENTOFU_TFVARS,
  EC2_ASG_OPENTOFU_BACKEND,
  EC2_ASG_BOOTSTRAP_BUNDLE_PATH,
  ec2AsgStackInputs,
} from "./cloud-control-setup-ec2-asg-iac";
import { EC2_ASG_IAC_PATHS } from "./cloud-control-aws-ec2-asg-iac-evidence";

export function ec2AsgIacCommands(
  input: CloudControlSetupInput,
  prelude: string,
): RunbookCommand[] {
  if (input.ec2HostMode !== "repo-owned-asg") return [];
  return [
    {
      id: "ec2-asg-opentofu-plan",
      command: opentofuPlanCommand(prelude),
      cwd: "profile-root",
      actionType: "reviewed-iac",
      evidenceGuidance:
        "run ASG OpenTofu plan from the bundle-root stack, review output, then write typed plan evidence",
      inputs: ec2AsgStackInputs(),
      outputs: [
        "$PROFILE_ROOT/ec2-asg-opentofu.tfplan",
        "$PROFILE_ROOT/ec2-asg-opentofu-plan.out.json",
        EC2_ASG_IAC_PATHS.plan,
      ],
      mustPass: "typed EC2 ASG plan evidence is supplied from bundle-root artifacts",
    },
    {
      id: "ec2-asg-opentofu-apply",
      command: opentofuApplyCommand(prelude),
      cwd: "profile-root",
      actionType: "reviewed-iac",
      evidenceGuidance:
        "apply reviewed ASG OpenTofu plan, review output, then write typed apply evidence",
      inputs: ["$PROFILE_ROOT/ec2-asg-opentofu.tfplan", ...ec2AsgStackInputs()],
      outputs: ["$PROFILE_ROOT/ec2-asg-opentofu-apply.out.json", EC2_ASG_IAC_PATHS.apply],
      mustPass: "typed EC2 ASG apply evidence is supplied from bundle-root artifacts",
    },
    {
      id: "ec2-asg-readonly-evidence",
      command: readOnlyCommand(prelude),
      cwd: "profile-root",
      actionType: "read-only-evidence",
      evidenceGuidance:
        "collect ASG, launch-template, instance, and security posture with read-only AWS commands",
      inputs: [
        "$PROFILE_ROOT/aws-topology-evidence.json",
        "$PROFILE_ROOT/ec2-asg-opentofu-apply.out.json",
        EC2_ASG_IAC_PATHS.apply,
      ],
      outputs: [
        "$PROFILE_ROOT/ec2-asg-readonly-autoscaling.json",
        "$PROFILE_ROOT/ec2-asg-readonly-launch-template.json",
        "$PROFILE_ROOT/ec2-asg-readonly-instances.json",
        EC2_ASG_IAC_PATHS.readOnly,
      ],
      mustPass: "typed EC2 ASG read-only evidence is supplied before provider evidence",
    },
  ];
}

function opentofuPlanCommand(prelude: string): string {
  return [
    prelude,
    `test -d "${EC2_ASG_OPENTOFU_DIR}"`,
    `test -f "${EC2_ASG_OPENTOFU_TFVARS}"`,
    `test -f "${EC2_ASG_OPENTOFU_BACKEND}"`,
    `test -f "${EC2_ASG_BOOTSTRAP_BUNDLE_PATH}"`,
    tofuInit(),
    workspaceCommand(),
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ec2-asg" tofu -chdir="${EC2_ASG_OPENTOFU_DIR}" plan -input=false -var-file="${EC2_ASG_OPENTOFU_TFVARS}" -out="$PROFILE_ROOT/ec2-asg-opentofu.tfplan"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ec2-asg" tofu -chdir="${EC2_ASG_OPENTOFU_DIR}" show -json "$PROFILE_ROOT/ec2-asg-opentofu.tfplan" > "$PROFILE_ROOT/ec2-asg-opentofu-plan.out.json"`,
    requireFile(EC2_ASG_IAC_PATHS.plan, "write typed EC2 ASG plan evidence after review"),
  ].join("; ");
}

function opentofuApplyCommand(prelude: string): string {
  return [
    prelude,
    `test -f "$PROFILE_ROOT/ec2-asg-opentofu.tfplan"`,
    `test -f "${EC2_ASG_IAC_PATHS.plan}"`,
    tofuInit(),
    workspaceCommand(),
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ec2-asg" tofu -chdir="${EC2_ASG_OPENTOFU_DIR}" apply -input=false "$PROFILE_ROOT/ec2-asg-opentofu.tfplan"`,
    `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ec2-asg" tofu -chdir="${EC2_ASG_OPENTOFU_DIR}" output -json > "$PROFILE_ROOT/ec2-asg-opentofu-apply.out.json"`,
    requireFile(EC2_ASG_IAC_PATHS.apply, "write typed EC2 ASG apply evidence after review"),
  ].join("; ");
}

function readOnlyCommand(prelude: string): string {
  return [
    prelude,
    `test -f "${EC2_ASG_IAC_PATHS.apply}"`,
    `test -f "$PROFILE_ROOT/ec2-asg-opentofu-apply.out.json"`,
    `AWS_REGION="$(node -e 'const fs=require("fs"); const t=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/aws-topology-evidence.json","utf8")); process.stdout.write(t.region || "")')"`,
    `ASG_NAME="$(node -e '${outputIdentity("asg")}')"`,
    `LT_ID="$(node -e '${outputIdentity("launchTemplateId")}')"`,
    `aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG_NAME" --region "$AWS_REGION" > "$PROFILE_ROOT/ec2-asg-readonly-autoscaling.json"`,
    `aws ec2 describe-launch-template-versions --launch-template-id "$LT_ID" --versions '$Latest' --region "$AWS_REGION" > "$PROFILE_ROOT/ec2-asg-readonly-launch-template.json"`,
    `aws ec2 describe-instances --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" --region "$AWS_REGION" > "$PROFILE_ROOT/ec2-asg-readonly-instances.json"`,
    requireFile(EC2_ASG_IAC_PATHS.readOnly, "write typed EC2 ASG read-only evidence after review"),
  ].join("; ");
}

function tofuInit() {
  return `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ec2-asg" tofu -chdir="${EC2_ASG_OPENTOFU_DIR}" init -input=false -backend-config="${EC2_ASG_OPENTOFU_BACKEND}"`;
}

function workspaceCommand() {
  return `TF_DATA_DIR="$PROFILE_ROOT/.tofu/ec2-asg" tofu -chdir="${EC2_ASG_OPENTOFU_DIR}" workspace select deployment-control-plane || TF_DATA_DIR="$PROFILE_ROOT/.tofu/ec2-asg" tofu -chdir="${EC2_ASG_OPENTOFU_DIR}" workspace new deployment-control-plane`;
}

function requireFile(file: string, message: string) {
  return `test -f "${file}" || { echo ${JSON.stringify(message)} >&2; exit 2; }`;
}

function outputIdentity(field: "asg" | "launchTemplateId") {
  return [
    'const fs=require("fs")',
    'const out=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/ec2-asg-opentofu-apply.out.json","utf8"))',
    `process.stdout.write((((out.ec2_host||{}).value||{}).identity||{}).${field} || "")`,
  ].join(";");
}
