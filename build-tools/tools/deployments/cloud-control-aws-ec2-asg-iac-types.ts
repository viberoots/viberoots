export const EC2_ASG_PLAN_SCHEMA = "aws-ec2-asg-opentofu-plan@1";
export const EC2_ASG_APPLY_SCHEMA = "aws-ec2-asg-opentofu-apply@1";
export const EC2_ASG_READONLY_SCHEMA = "aws-ec2-asg-readonly-evidence@1";

export const EC2_ASG_IAC_PATHS = {
  plan: "$PROFILE_ROOT/ec2-asg-opentofu-plan.json",
  apply: "$PROFILE_ROOT/ec2-asg-opentofu-apply.json",
  readOnly: "$PROFILE_ROOT/ec2-asg-readonly-evidence.json",
} as const;

export type Ec2AsgIacBundle = {
  plan?: Ec2AsgIacRecord;
  apply?: Ec2AsgIacRecord;
  readOnly?: Ec2AsgIacRecord;
};

export type Ec2AsgIacRecord = Record<string, unknown> & {
  expected?: Ec2AsgIacExpected;
};

export type Ec2AsgIacExpected = Record<string, unknown> & {
  userDataPath?: string;
  userDataBase64?: string;
  userDataDigest?: string;
};

export const EC2_ASG_SHA256 = /^sha256:[0-9a-f]{64}$/;
