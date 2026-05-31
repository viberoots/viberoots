import { freshCheckedAt, IMAGE_REF } from "./cloud-control-aws-topology.fixture";

export function operationEnvelope(credentialManifestDigest = "sha256:credential-manifest") {
  return {
    operationIdentity: evidenceRef("operation/identity"),
    sourceHost: "aws-ec2-instance-i-123",
    hostProfile: "aws-ec2",
    checkedAt: freshCheckedAt(),
    imageDigest: IMAGE_REF,
    configDigest: "sha256:config",
    credentialManifestDigest,
  };
}

export function evidenceRef(ref: string) {
  return {
    schemaVersion: "cloud-cutover-evidence-ref@1",
    evidenceRef: ref,
    checkedAt: freshCheckedAt(),
    sourceHost: "aws-ec2-instance-i-123",
  };
}
