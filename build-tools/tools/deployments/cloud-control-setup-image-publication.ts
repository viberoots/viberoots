import fs from "node:fs";
import { getFlagStr } from "../lib/cli";
import type { ControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";

export type SetupImagePublicationFlags = {
  image: string;
  expectedImageBuildIdentity: string;
  imagePublication?: ControlPlaneImagePublicationEvidence;
  imagePublicationEvidencePath?: string;
};

export function readSetupImagePublicationFlags(): SetupImagePublicationFlags {
  const evidencePath = getFlagStr("image-publication-evidence", "").trim();
  const evidence = evidencePath ? readImagePublicationEvidence(evidencePath) : undefined;
  const image = getFlagStr("image", "").trim() || evidence?.image || "";
  const expectedImageBuildIdentity =
    getFlagStr("expected-image-build-identity", "").trim() || evidence?.imageBuildIdentity || "";
  return {
    image,
    expectedImageBuildIdentity,
    imagePublication: evidence || imagePublicationFromDirectFlags(image),
    ...(evidencePath ? { imagePublicationEvidencePath: evidencePath } : {}),
  };
}

export function assertProductionImagePublicationEvidence(flags: SetupImagePublicationFlags): void {
  if (!flags.imagePublicationEvidencePath) {
    throw new Error(
      "production AWS setup requires --image-publication-evidence from control-plane image-publication",
    );
  }
  if (flags.imagePublication?.evidenceSource !== "generated-command") {
    throw new Error("production AWS setup requires generated image publication evidence");
  }
  if (!flags.imagePublication.registryProfile) {
    throw new Error("production AWS setup requires registry profile evidence");
  }
}

function readImagePublicationEvidence(filePath: string): ControlPlaneImagePublicationEvidence {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  if (parsed.schemaVersion !== "cloud-control-image-publication@1") {
    throw new Error("image publication evidence schema is unsupported");
  }
  return parsed as ControlPlaneImagePublicationEvidence;
}

function imagePublicationFromDirectFlags(
  image: string,
): ControlPlaneImagePublicationEvidence | undefined {
  const sourceRevision = getFlagStr("image-source-revision", "").trim();
  const imageBuildIdentity = getFlagStr("image-build-identity", "").trim();
  const digest = getFlagStr("image-publication-digest", "").trim();
  const inspectedDigest = getFlagStr("image-inspected-digest", "").trim();
  const tag = getFlagStr("image-tag", "").trim() || sourceRevision;
  if (![sourceRevision, imageBuildIdentity, digest, inspectedDigest, tag].some(Boolean)) {
    return undefined;
  }
  return {
    image,
    sourceRevision,
    imageBuildIdentity,
    digest,
    inspectedDigest,
    tag,
    evidenceSource: "direct-flags",
  };
}
