export const EC2_ASG_PLAN_SCHEMA = "aws-ec2-asg-opentofu-plan@1";
export const EC2_ASG_APPLY_SCHEMA = "aws-ec2-asg-opentofu-apply@1";
export const EC2_ASG_READONLY_SCHEMA = "aws-ec2-asg-readonly-evidence@1";

export const EC2_ASG_IAC_PATHS = {
  plan: "$PROFILE_ROOT/ec2-asg-opentofu-plan.json",
  apply: "$PROFILE_ROOT/ec2-asg-opentofu-apply.json",
  readOnly: "$PROFILE_ROOT/ec2-asg-readonly-evidence.json",
  credentialProvenance: "$PROFILE_ROOT/ec2-asg-aws-credential-provenance.json",
  callerIdentity: "$PROFILE_ROOT/ec2-asg-readonly-caller-identity.json",
} as const;

export const EC2_ASG_OPENTOFU_WORKING_DIR = "$PROFILE_ROOT/opentofu/aws-ec2-asg";
export const EC2_ASG_CREDENTIAL_MODES = [
  "file-backed-profile",
  "assume-role",
  "instance-profile",
] as const;

export type Ec2AsgAwsCredentialMode = (typeof EC2_ASG_CREDENTIAL_MODES)[number];

export type Ec2AsgIacBundle = {
  plan?: Ec2AsgIacRecord;
  apply?: Ec2AsgIacRecord;
  readOnly?: Ec2AsgIacRecord;
};

export type Ec2AsgIacRecord = Record<string, unknown> & {
  expected?: Ec2AsgIacExpected;
  reviewedCredentialBoundary?: Ec2AsgAwsCredentialProvenance;
  credentialProvenance?: Ec2AsgAwsCredentialProvenance;
};

export type Ec2AsgIacExpected = Record<string, unknown> & {
  userDataPath?: string;
  userDataBase64?: string;
  userDataDigest?: string;
};

export type Ec2AsgAwsCredentialProvenance = {
  mode: Ec2AsgAwsCredentialMode;
  accountId: string;
  region: string;
  reviewedReference: string;
  boundaryDigest: string;
  profileName?: string;
  sharedCredentialsFile?: string;
  roleArn?: string;
  sessionName?: string;
  sourceProfileName?: string;
  instanceProfileArn?: string;
};

export const EC2_ASG_SHA256 = /^sha256:[0-9a-f]{64}$/;
