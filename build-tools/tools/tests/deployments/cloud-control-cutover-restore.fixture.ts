import { freshCheckedAt, IMAGE_DIGEST } from "./cloud-control-aws-topology.fixture";

export function restoreEvidence(common: Record<string, unknown> = {}) {
  return {
    ...common,
    databaseRecords: evidenceRef("restore/database-records"),
    artifactObjects: evidenceRef("restore/artifact-objects"),
    stageState: evidenceRef("restore/stage-state"),
    imageDigest: String(common.imageDigest || IMAGE_DIGEST),
    configDigest: String(common.configDigest || "sha256:config"),
    credentialManifestDigest: String(
      common.credentialManifestDigest || "sha256:credential-manifest",
    ),
    authConfiguration: evidenceRef("restore/auth-config"),
    durableStateReferences: [
      evidenceRef("restore/submission-1"),
      evidenceRef("restore/artifact-1"),
    ],
  };
}

function evidenceRef(ref: string) {
  return {
    schemaVersion: "cloud-cutover-evidence-ref@1",
    evidenceRef: ref,
    checkedAt: freshCheckedAt(),
    sourceHost: "aws-ec2-instance-i-123",
  };
}
