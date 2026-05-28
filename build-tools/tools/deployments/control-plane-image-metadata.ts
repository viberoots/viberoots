import {
  buildOnlyControlPlaneImageDigestContract,
  type ControlPlaneImageDigestContract,
  verifiedControlPlaneImageDigestContract,
} from "./control-plane-image-publication";

export type ControlPlaneImageMetadata = {
  version: string;
  sourceRevision: string;
  imageBuildIdentity: string;
  imageDigest: string;
  imageDigestStatus: ControlPlaneImageDigestContract["publication"]["status"];
  digestContract: ControlPlaneImageDigestContract;
};

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BUILD_IDENTITY_PATTERN = /^nix-source-[a-f0-9]{64}$/;
const DEFAULT_BUILD_IDENTITY = `nix-source-${"0".repeat(64)}`;
const VERIFIED_STATUS = "verified-registry-publication";

export function readControlPlaneImageMetadata(
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneImageMetadata {
  const imageDigest = nonSecretValue(env.VBR_CONTROL_PLANE_IMAGE_DIGEST, "build-only");
  const sourceRevision = nonSecretValue(env.VBR_CONTROL_PLANE_SOURCE_REVISION, "source-local");
  const imageBuildIdentity = imageBuildIdentityValue(env.VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY);
  const digestContract = imageDigestContract(env, sourceRevision, imageBuildIdentity, imageDigest);
  return {
    version: nonSecretValue(env.VBR_CONTROL_PLANE_VERSION),
    sourceRevision,
    imageBuildIdentity,
    imageDigest,
    imageDigestStatus: digestContract.publication.status,
    digestContract,
  };
}

function imageDigestContract(
  env: NodeJS.ProcessEnv,
  sourceRevision: string,
  imageBuildIdentity: string,
  imageDigest: string,
): ControlPlaneImageDigestContract {
  if (
    env.VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS === VERIFIED_STATUS &&
    DIGEST_PATTERN.test(imageDigest) &&
    DIGEST_PATTERN.test(String(env.VBR_CONTROL_PLANE_IMAGE_INSPECTED_DIGEST || "")) &&
    BUILD_IDENTITY_PATTERN.test(String(env.VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY || "")) &&
    String(env.VBR_CONTROL_PLANE_SOURCE_REVISION || "").trim() &&
    String(env.VBR_CONTROL_PLANE_IMAGE_TAG || "").trim() &&
    env.VBR_CONTROL_PLANE_IMAGE_REF
  ) {
    try {
      return verifiedControlPlaneImageDigestContract({
        image: env.VBR_CONTROL_PLANE_IMAGE_REF,
        sourceRevision,
        imageBuildIdentity,
        digest: imageDigest,
        inspectedDigest: env.VBR_CONTROL_PLANE_IMAGE_INSPECTED_DIGEST!,
        tag: env.VBR_CONTROL_PLANE_IMAGE_TAG!,
      });
    } catch {
      return buildOnlyContract(sourceRevision, imageBuildIdentity);
    }
  }
  return buildOnlyContract(sourceRevision, imageBuildIdentity);
}

function buildOnlyContract(
  sourceRevision: string,
  imageBuildIdentity: string,
): ControlPlaneImageDigestContract {
  try {
    return buildOnlyControlPlaneImageDigestContract(sourceRevision, imageBuildIdentity);
  } catch {
    return buildOnlyControlPlaneImageDigestContract(sourceRevision, DEFAULT_BUILD_IDENTITY);
  }
}

function imageBuildIdentityValue(value: string | undefined): string {
  const identity = nonSecretValue(value, DEFAULT_BUILD_IDENTITY);
  return BUILD_IDENTITY_PATTERN.test(identity) ? identity : DEFAULT_BUILD_IDENTITY;
}

function nonSecretValue(value: string | undefined, fallback = "unknown"): string {
  const trimmed = String(value || "").trim();
  return trimmed || fallback;
}
