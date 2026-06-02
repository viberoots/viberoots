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
        EC2_ASG_IAC_PATHS.credentialProvenance,
      ],
      outputs: [
        EC2_ASG_IAC_PATHS.callerIdentity,
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
    clearAmbientAwsEnvFunction(),
    `test -f "${EC2_ASG_IAC_PATHS.apply}"`,
    `test -f "$PROFILE_ROOT/ec2-asg-opentofu-apply.out.json"`,
    `AWS_REGION="$(node -e 'const fs=require("fs"); const t=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/aws-topology-evidence.json","utf8")); process.stdout.write(t.region || "")')"`,
    `ASG_NAME="$(node -e '${outputIdentity("asg")}')"`,
    `LT_ID="$(node -e '${outputIdentity("launchTemplateId")}')"`,
    reviewedCredentialSetup(),
    `aws sts get-caller-identity --region "$AWS_REGION" > "${EC2_ASG_IAC_PATHS.callerIdentity}"`,
    `CALLER_ACCOUNT="$(node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync(process.env.PROFILE_ROOT + "/ec2-asg-readonly-caller-identity.json","utf8")); process.stdout.write(c.Account || "")')"`,
    `CRED_ACCOUNT="$(node -e '${credentialField("accountId")}')"`,
    `test "$CALLER_ACCOUNT" = "$CRED_ACCOUNT" || { echo "reviewed ASG credential account does not match caller identity" >&2; exit 2; }`,
    `aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG_NAME" --region "$AWS_REGION" > "$PROFILE_ROOT/ec2-asg-readonly-autoscaling.json"`,
    `aws ec2 describe-launch-template-versions --launch-template-id "$LT_ID" --versions '$Latest' --region "$AWS_REGION" > "$PROFILE_ROOT/ec2-asg-readonly-launch-template.json"`,
    `aws ec2 describe-instances --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" --region "$AWS_REGION" > "$PROFILE_ROOT/ec2-asg-readonly-instances.json"`,
    requireFile(EC2_ASG_IAC_PATHS.readOnly, "write typed EC2 ASG read-only evidence after review"),
  ].join("; ");
}

function reviewedCredentialSetup(): string {
  return [
    `test -f "${EC2_ASG_IAC_PATHS.credentialProvenance}"`,
    `CRED_REGION="$(node -e '${credentialField("region")}')"`,
    `test "$CRED_REGION" = "$AWS_REGION" || { echo "reviewed ASG credential region does not match topology" >&2; exit 2; }`,
    `CRED_MODE="$(node -e '${credentialField("mode")}')"`,
    `case "$CRED_MODE" in ${profileMode()} ${assumeRoleMode()} ${instanceProfileMode()} *) echo "unsupported reviewed ASG credential mode: $CRED_MODE" >&2; exit 2;; esac`,
  ].join("; ");
}

function profileMode(): string {
  return [
    `"file-backed-profile") REVIEWED_PROFILE="$(node -e '${credentialField("profileName")}')"`,
    `REVIEWED_SHARED_CREDENTIALS_FILE="$(node -e '${credentialField("sharedCredentialsFile")}')"`,
    `test -n "$REVIEWED_PROFILE"`,
    `test "$REVIEWED_PROFILE" != "default"`,
    `test -n "$REVIEWED_SHARED_CREDENTIALS_FILE"`,
    `_ec2_asg_clear_ambient_aws_env`,
    `AWS_PROFILE="$REVIEWED_PROFILE"`,
    `AWS_SHARED_CREDENTIALS_FILE="$REVIEWED_SHARED_CREDENTIALS_FILE"`,
    `AWS_SDK_LOAD_CONFIG=1`,
    `AWS_EC2_METADATA_DISABLED=true`,
    `export AWS_PROFILE AWS_SHARED_CREDENTIALS_FILE AWS_SDK_LOAD_CONFIG AWS_EC2_METADATA_DISABLED`,
    `;;`,
  ].join("; ");
}

function assumeRoleMode(): string {
  return [
    `"assume-role") SOURCE_PROFILE="$(node -e '${credentialField("sourceProfileName")}')"`,
    `REVIEWED_SHARED_CREDENTIALS_FILE="$(node -e '${credentialField("sharedCredentialsFile")}')"`,
    `ROLE_ARN="$(node -e '${credentialField("roleArn")}')"`,
    `SESSION_NAME="$(node -e '${credentialField("sessionName")}')"`,
    `test -n "$SOURCE_PROFILE"`,
    `test "$SOURCE_PROFILE" != "default"`,
    `test -n "$REVIEWED_SHARED_CREDENTIALS_FILE"`,
    `test -n "$ROLE_ARN"`,
    `test -n "$SESSION_NAME"`,
    `_ec2_asg_clear_ambient_aws_env`,
    `ASSUMED="$(AWS_PROFILE="$SOURCE_PROFILE" AWS_SHARED_CREDENTIALS_FILE="$REVIEWED_SHARED_CREDENTIALS_FILE" aws sts assume-role --role-arn "$ROLE_ARN" --role-session-name "$SESSION_NAME" --region "$AWS_REGION" --output json)"`,
    `export ASSUMED`,
    `_ec2_asg_clear_ambient_aws_env`,
    `AWS_ACCESS_KEY_ID="$(node -e 'const c=JSON.parse(process.env.ASSUMED).Credentials; process.stdout.write(c.AccessKeyId || "")')"`,
    `AWS_SECRET_ACCESS_KEY="$(node -e 'const c=JSON.parse(process.env.ASSUMED).Credentials; process.stdout.write(c.SecretAccessKey || "")')"`,
    `AWS_SESSION_TOKEN="$(node -e 'const c=JSON.parse(process.env.ASSUMED).Credentials; process.stdout.write(c.SessionToken || "")')"`,
    `export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN`,
    `unset AWS_PROFILE SOURCE_PROFILE REVIEWED_SHARED_CREDENTIALS_FILE ASSUMED`,
    `;;`,
  ].join("; ");
}

function instanceProfileMode(): string {
  return [
    `"instance-profile") test -n "$(node -e '${credentialField("instanceProfileArn")}')"`,
    `_ec2_asg_clear_ambient_aws_env`,
    `export AWS_EC2_METADATA_DISABLED=false`,
    `;;`,
  ].join("; ");
}

function clearAmbientAwsEnvFunction(): string {
  return `_ec2_asg_clear_ambient_aws_env() { unset ${AWS_AMBIENT_ENV_VARS.join(" ")}; AWS_SHARED_CREDENTIALS_FILE=/dev/null; AWS_CONFIG_FILE=/dev/null; AWS_EC2_METADATA_DISABLED=true; export AWS_SHARED_CREDENTIALS_FILE AWS_CONFIG_FILE AWS_EC2_METADATA_DISABLED; }`;
}

const AWS_AMBIENT_ENV_VARS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
  "AWS_SDK_LOAD_CONFIG",
  "AWS_ENDPOINT_URL",
  "AWS_ENDPOINT_URL_STS",
  "AWS_ENDPOINT_URL_EC2",
  "AWS_ENDPOINT_URL_AUTO_SCALING",
  "AWS_DEFAULT_REGION",
  "AWS_ROLE_ARN",
  "AWS_ROLE_SESSION_NAME",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  "AWS_SSO_SESSION",
  "AWS_SSO_START_URL",
  "AWS_SSO_REGION",
  "AWS_SSO_ACCOUNT_ID",
  "AWS_SSO_ROLE_NAME",
  "AWS_EC2_METADATA_SERVICE_ENDPOINT",
  "AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE",
  "AWS_METADATA_SERVICE_TIMEOUT",
  "AWS_METADATA_SERVICE_NUM_ATTEMPTS",
];

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

function credentialField(field: string) {
  return [
    'const fs=require("fs")',
    'const p=process.env.PROFILE_ROOT + "/ec2-asg-aws-credential-provenance.json"',
    "const c=JSON.parse(fs.readFileSync(p,'utf8'))",
    `process.stdout.write(c.${field} || "")`,
  ].join(";");
}
