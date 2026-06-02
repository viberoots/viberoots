import { setupAwsTopology } from "./cloud-control-setup-aws-topology";
import {
  opentofuSourceInputs,
  renderOpenTofuSourceFiles,
} from "./cloud-control-setup-opentofu-stack";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import {
  EC2_ASG_BOOTSTRAP_BUNDLE_PATH,
  EC2_ASG_BOOTSTRAP_FILE,
  ec2AsgBootstrapBase64,
  ec2AsgBootstrapDigest,
  ec2AsgBootstrapUserData,
} from "./cloud-control-aws-ec2-asg-bootstrap";
import {
  EC2_ASG_IAC_PATHS,
  EC2_ASG_OPENTOFU_WORKING_DIR,
} from "./cloud-control-aws-ec2-asg-iac-types";

const EC2_ASG_OPENTOFU_SOURCE_DIR = "build-tools/deployments/aws-ec2-asg/opentofu";
const EC2_ASG_OPENTOFU_BUNDLE_DIR = "opentofu/aws-ec2-asg";

export const EC2_ASG_OPENTOFU_DIR = EC2_ASG_OPENTOFU_WORKING_DIR;
export const EC2_ASG_OPENTOFU_TFVARS = "$PROFILE_ROOT/ec2-asg-opentofu.tfvars.json";
export const EC2_ASG_OPENTOFU_BACKEND = "$PROFILE_ROOT/ec2-asg-backend.hcl";
export { EC2_ASG_BOOTSTRAP_BUNDLE_PATH };

export function renderEc2AsgOpenTofuFiles(input: CloudControlSetupInput) {
  if (input.ec2HostMode !== "repo-owned-asg") return {};
  return {
    ...renderOpenTofuSourceFiles(EC2_ASG_OPENTOFU_SOURCE_DIR, EC2_ASG_OPENTOFU_BUNDLE_DIR),
    [EC2_ASG_BOOTSTRAP_FILE]: ec2AsgBootstrapUserData(),
    "ec2-asg-opentofu.tfvars.json": `${JSON.stringify(ec2AsgTfvars(input), null, 2)}\n`,
    "ec2-asg-backend.hcl": ec2AsgBackendConfig(input),
    "ec2-asg-evidence-template.json": `${JSON.stringify(ec2AsgEvidenceTemplate(), null, 2)}\n`,
  };
}

export function ec2AsgStackInputs() {
  return [
    EC2_ASG_OPENTOFU_BACKEND,
    EC2_ASG_OPENTOFU_TFVARS,
    EC2_ASG_BOOTSTRAP_BUNDLE_PATH,
    ...opentofuSourceInputs(EC2_ASG_OPENTOFU_SOURCE_DIR, EC2_ASG_OPENTOFU_BUNDLE_DIR),
  ];
}

function ec2AsgBackendConfig(input: CloudControlSetupInput) {
  const region = input.awsTopology?.region || input.artifactRegion;
  return [
    `bucket         = ${JSON.stringify(`${input.instanceId}-tofu-state`)}`,
    `key            = ${JSON.stringify(`aws-foundation/${input.instanceId}/ec2-asg.tfstate`)}`,
    `region         = ${JSON.stringify(region)}`,
    `dynamodb_table = ${JSON.stringify(`${input.instanceId}-tofu-state-lock`)}`,
    "encrypt        = true",
    "",
  ].join("\n");
}

function ec2AsgTfvars(input: CloudControlSetupInput) {
  const topology = setupAwsTopology(input) as any;
  const compute = topology?.compute || {};
  const amiSelection = compute.amiSelection || {};
  const deployment = input.deploymentIds[0] || "reviewed";
  return {
    region: topology?.region || input.artifactRegion,
    name_prefix: input.instanceId,
    tags: {
      owner: "deployment-control-plane",
      environment: deployment,
      dataClassification: "restricted",
      hostMode: "repo-owned-asg",
      rollback: "non-destructive",
    },
    ec2_host_mode: "repo-owned-asg",
    ec2_asg_name: compute.autoScalingGroupName || `${input.instanceId}-control-plane`,
    ec2_ami_id: compute.amiId,
    ec2_ami_build_identity: compute.amiBuildIdentity || amiSelection.buildIdentity || "",
    ec2_ami_evidence_path: amiSelection.path || amiSelection.pinPath || "",
    ec2_instance_type: compute.instanceType,
    ec2_instance_profile_arn: compute.instanceProfileArn,
    ec2_private_subnet_ids: compute.launchTemplateSubnetIds || [],
    ec2_security_group_ids: compute.securityGroupIds || [],
    ec2_user_data_path: EC2_ASG_BOOTSTRAP_BUNDLE_PATH,
    ec2_user_data_base64: ec2AsgBootstrapBase64(),
    ec2_user_data_digest: ec2AsgBootstrapDigest(),
    ec2_service_capacity: input.serviceReplicas,
    ec2_worker_capacity: input.workerReplicas,
    ec2_import_adoption_metadata: {
      mode: "managed",
      reviewed_reference: "docs/control-plane-guide.md#ec2-host-realization-mode",
      import_block: "review and add import blocks before apply when adopting an existing ASG",
    },
  };
}

function ec2AsgEvidenceTemplate() {
  return {
    templateOnly: true,
    bundleRoot: "$PROFILE_ROOT",
    workingDirectory: EC2_ASG_OPENTOFU_DIR,
    backendConfig: EC2_ASG_OPENTOFU_BACKEND,
    bootstrapUserData: EC2_ASG_BOOTSTRAP_BUNDLE_PATH,
    requiredEvidenceFiles: [
      "$PROFILE_ROOT/ec2-asg-opentofu-plan.json",
      "$PROFILE_ROOT/ec2-asg-opentofu-apply.json",
      "$PROFILE_ROOT/ec2-asg-readonly-evidence.json",
      "$PROFILE_ROOT/ec2-asg-aws-credential-provenance.json",
      "$PROFILE_ROOT/ec2-asg-readonly-caller-identity.json",
    ],
    reviewedCredentialBoundary: credentialBoundaryTemplate(),
    credentialProvenance: credentialBoundaryTemplate(),
    note: "Do not submit this template as evidence. Write reviewed typed evidence after running the generated ASG commands.",
  };
}

function credentialBoundaryTemplate() {
  return {
    mode: "file-backed-profile | assume-role | instance-profile",
    accountId: "<12-digit-reviewed-account-id>",
    region: "<reviewed-aws-region>",
    reviewedReference: "evidence://reviewed/aws/asg-readonly-credentials",
    boundaryDigest: "sha256:<reviewed-boundary-digest>",
    profileName: "<required for file-backed-profile>",
    sharedCredentialsFile: "<required for file-backed-profile or assume-role>",
    roleArn: "<required for assume-role>",
    sessionName: "<required for assume-role>",
    sourceProfileName: "<required for assume-role>",
    instanceProfileArn: "<required for instance-profile>",
    callerIdentityEvidencePath: EC2_ASG_IAC_PATHS.callerIdentity,
  };
}
