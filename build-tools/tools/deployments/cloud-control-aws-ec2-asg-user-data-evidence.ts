import {
  EC2_ASG_BOOTSTRAP_BUNDLE_PATH,
  ec2AsgBootstrapBase64,
  ec2AsgBootstrapDigest,
} from "./cloud-control-aws-ec2-asg-bootstrap";
import {
  compareEvidenceField,
  recordObject,
  recordText,
} from "./cloud-control-aws-ec2-asg-iac-helpers";

const USER_DATA_FIELDS = ["userDataPath", "userDataBase64", "userDataDigest"] as const;

export function userDataIdentityErrors(
  label: string,
  record: Record<string, unknown>,
  profile?: Record<string, unknown>,
) {
  const expected = recordObject(record.expected);
  const profileCompute = recordObject(profile?.compute);
  const errors: string[] = [];
  compareEvidenceField(
    errors,
    label,
    "userDataPath",
    recordText(expected, "userDataPath"),
    EC2_ASG_BOOTSTRAP_BUNDLE_PATH,
  );
  compareEvidenceField(
    errors,
    label,
    "userDataBase64",
    recordText(expected, "userDataBase64"),
    ec2AsgBootstrapBase64(),
  );
  compareEvidenceField(
    errors,
    label,
    "userDataDigest",
    recordText(expected, "userDataDigest"),
    ec2AsgBootstrapDigest(),
  );
  compareEvidenceField(
    errors,
    label,
    "userDataDigest",
    recordText(expected, "userDataDigest"),
    recordText(profileCompute, "bootstrapDigest"),
  );
  return errors;
}

export function userDataTransitionErrors(
  label: string,
  record: Record<string, unknown>,
  previous: Record<string, unknown>,
  previousLabel: string,
) {
  const expected = recordObject(record.expected);
  const previousExpected = recordObject(previous.expected);
  return USER_DATA_FIELDS.flatMap((field) =>
    recordText(expected, field) === recordText(previousExpected, field)
      ? []
      : [`EC2 ASG ${label} ${field} does not match ${previousLabel} evidence`],
  );
}
