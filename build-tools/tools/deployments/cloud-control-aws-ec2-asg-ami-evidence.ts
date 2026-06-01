import {
  compareEvidenceField,
  recordObject,
  recordText,
} from "./cloud-control-aws-ec2-asg-iac-helpers";

export function amiEvidenceErrors(
  label: string,
  expected: Record<string, unknown>,
  compute: Record<string, unknown>,
) {
  const selection = recordObject(compute.amiSelection);
  const errors: string[] = [];
  compareEvidenceField(
    errors,
    label,
    "amiBuildIdentity",
    recordText(expected, "amiBuildIdentity"),
    compute.amiBuildIdentity,
  );
  compareEvidenceField(
    errors,
    label,
    "amiEvidencePath",
    recordText(expected, "amiEvidencePath"),
    recordText(selection, "path") || recordText(selection, "pinPath"),
  );
  return errors;
}
