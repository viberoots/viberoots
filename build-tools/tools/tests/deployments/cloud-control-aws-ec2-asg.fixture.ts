import { privateLinkAwsTopology } from "./cloud-control-aws-topology.fixture";
import {
  EC2_ASG_BOOTSTRAP_BUNDLE_PATH,
  ec2AsgBootstrapBase64,
  ec2AsgBootstrapDigest,
} from "../../deployments/cloud-control-aws-ec2-asg-bootstrap";
import { EC2_ASG_OPENTOFU_WORKING_DIR } from "../../deployments/cloud-control-aws-ec2-asg-iac-types";

const DIGEST = `sha256:${"c".repeat(64)}`;
const APPLY = `sha256:${"d".repeat(64)}`;
const EVIDENCE = `sha256:${"e".repeat(64)}`;
const CREDENTIAL_BOUNDARY = `sha256:${"f".repeat(64)}`;

export function asgTopology(overrides: Record<string, unknown> = {}) {
  const base = privateLinkAwsTopology();
  return privateLinkAwsTopology({
    compute: {
      ...(base as any).compute,
      mode: "auto-scaling-group",
      instanceId: "",
      autoScalingGroupName: "control-plane-asg",
      launchTemplateVersion: "9",
      userData: {
        activatesGeneratedArtifacts: true,
        providerMutation: false,
        digest: "sha256:user",
      },
    },
    ...overrides,
  });
}

export function asgIac(overrides: Record<string, any> = {}) {
  const common = {
    workingDirectory: EC2_ASG_OPENTOFU_WORKING_DIR,
    ec2HostMode: "repo-owned-asg",
    expected: {
      accountId: "123456789012",
      region: "us-east-1",
      autoScalingGroupName: "control-plane-asg",
      launchTemplateId: "lt-123",
      launchTemplateVersion: "9",
      amiId: "ami-123",
      amiBuildIdentity:
        "nix-source-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      amiEvidencePath: "sha256:nixos-ami-import",
      instanceType: "m7i.large",
      instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/control-plane",
      privateSubnetIds: ["subnet-123", "subnet-456"],
      securityGroupIds: ["sg-service", "sg-worker"],
      userDataPath: EC2_ASG_BOOTSTRAP_BUNDLE_PATH,
      userDataBase64: ec2AsgBootstrapBase64(),
      userDataDigest: ec2AsgBootstrapDigest(),
      serviceCapacity: 1,
      workerReplicas: 2,
    },
    security: { httpTokens: "required", rootVolumeEncrypted: true, noStandingSsh: true },
    observability: { logSink: "cloudwatch", alarmPosture: "required" },
    reviewedInstancePosture: "m7i.large reviewed for control-plane service and workers",
    rollback: { nonDestructive: true, launchTemplateVersionRollback: true, workerDrain: true },
    importAdoption: { mode: "managed", reviewedReference: "docs/control-plane-guide.md" },
    reviewedCredentialBoundary: {
      mode: "file-backed-profile",
      accountId: "123456789012",
      region: "us-east-1",
      reviewedReference: "evidence://reviewed/aws/asg-readonly-credentials",
      boundaryDigest: CREDENTIAL_BOUNDARY,
      profileName: "reviewed-control-plane-readonly",
      sharedCredentialsFile: "/run/deployment-control-plane/credentials/aws-readonly",
    },
  };
  return {
    plan: {
      schemaVersion: "aws-ec2-asg-opentofu-plan@1",
      source: "reviewed-opentofu-plan",
      planDigest: DIGEST,
      evidencePath: "$PROFILE_ROOT/ec2-asg-opentofu-plan.json",
      ...common,
    },
    apply: {
      schemaVersion: "aws-ec2-asg-opentofu-apply@1",
      source: "reviewed-opentofu-apply",
      planDigest: DIGEST,
      applyDigest: APPLY,
      evidencePath: "$PROFILE_ROOT/ec2-asg-opentofu-apply.json",
      ...common,
    },
    readOnly: {
      schemaVersion: "aws-ec2-asg-readonly-evidence@1",
      source: "aws-ec2-asg-readonly-inspection",
      applyDigest: APPLY,
      evidenceDigest: EVIDENCE,
      evidencePath: "$PROFILE_ROOT/ec2-asg-readonly-evidence.json",
      callerIdentityEvidencePath: "$PROFILE_ROOT/ec2-asg-readonly-caller-identity.json",
      credentialProvenance: common.reviewedCredentialBoundary,
      ...common,
    },
    ...overrides,
  };
}
